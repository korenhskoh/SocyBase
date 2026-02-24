import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from jose import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.credit import CreditBalance
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.services.auth_service import (
    _create_tokens,
    _slugify,
    login_user,
    refresh_tokens,
    register_user,
)
from app.utils.security import decode_token, hash_password

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("5/minute")
async def register(request: Request, data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    _, tokens = await register_user(data, db)
    return tokens


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, data: LoginRequest, db: AsyncSession = Depends(get_db)):
    _, tokens = await login_user(data, db)
    return tokens


@router.post("/refresh", response_model=TokenResponse)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    return await refresh_tokens(data.refresh_token, db)


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.put("/me", response_model=UserResponse)
async def update_me(
    data: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.language is not None:
        user.language = data.language
    if data.avatar_url is not None:
        user.avatar_url = data.avatar_url
    await db.flush()
    return user


# ---------------------------------------------------------------------------
# Forgot / Reset Password
# ---------------------------------------------------------------------------


@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    settings = get_settings()

    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if user:
        # Create a password-reset JWT valid for 1 hour
        expire = datetime.now(timezone.utc) + timedelta(hours=1)
        token_payload = {
            "sub": str(user.id),
            "type": "password_reset",
            "exp": expire,
        }
        reset_token = jwt.encode(
            token_payload,
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        # In production this would be emailed to the user
        logger.info("Password reset token for %s: %s", user.email, reset_token)

    # Always return 200 to prevent email enumeration
    return {"message": "If an account exists, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(data.token)

    if not payload or payload.get("type") != "password_reset":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    user.password_hash = hash_password(data.new_password)
    await db.flush()

    return {"message": "Password reset successfully."}


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


@router.get("/google")
async def google_login():
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=503,
            detail="Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.effective_google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    frontend_url = settings.frontend_url

    try:
        # Exchange authorization code for tokens
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.effective_google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_response.raise_for_status()
            token_data = token_response.json()

            # Fetch user info from Google
            access_token = token_data["access_token"]
            userinfo_response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            userinfo_response.raise_for_status()
            google_user = userinfo_response.json()

        google_email: str = google_user["email"]
        google_id: str = str(google_user["id"])
        google_name: str = google_user.get("name", google_email.split("@")[0])

        # Check if a user with this email already exists
        result = await db.execute(select(User).where(User.email == google_email))
        user = result.scalar_one_or_none()

        if user:
            # Existing user -- update last login and generate tokens
            user.last_login_at = datetime.now(timezone.utc)
            await db.flush()
            tokens = _create_tokens(user)
        else:
            # New user -- create tenant, user, and credit balance
            tenant_name = google_email.split("@")[0]
            slug = _slugify(tenant_name)

            # Ensure slug uniqueness
            slug_check = await db.execute(select(Tenant).where(Tenant.slug == slug))
            if slug_check.scalar_one_or_none():
                slug = f"{slug}-{str(uuid.uuid4())[:8]}"

            tenant = Tenant(name=tenant_name, slug=slug)
            db.add(tenant)
            await db.flush()

            user = User(
                tenant_id=tenant.id,
                email=google_email,
                full_name=google_name,
                role="tenant_admin",
                oauth_provider="google",
                oauth_provider_id=google_id,
                email_verified=True,
            )
            db.add(user)

            credit_balance = CreditBalance(tenant_id=tenant.id, balance=0)
            db.add(credit_balance)

            await db.flush()
            tokens = _create_tokens(user)

        # Create a short-lived auth code (JWT with 60s TTL) instead of passing tokens directly
        auth_code_payload = {
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "exp": datetime.now(timezone.utc) + timedelta(seconds=60),
            "type": "oauth_callback",
        }
        auth_code = jwt.encode(
            auth_code_payload,
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        return RedirectResponse(url=f"{frontend_url}/auth/callback?code={auth_code}")

    except Exception as exc:
        logger.exception("Google OAuth callback error")
        error_params = urlencode({"error": str(exc)})
        return RedirectResponse(url=f"{frontend_url}/auth/callback?{error_params}")


@router.post("/google/exchange", response_model=TokenResponse)
@limiter.limit("10/minute")
async def google_exchange(request: Request, code: str = Query(...)):
    """Exchange a short-lived OAuth callback code for access + refresh tokens."""
    settings = get_settings()
    try:
        payload = jwt.decode(code, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired auth code")

    if payload.get("type") != "oauth_callback":
        raise HTTPException(status_code=400, detail="Invalid auth code type")

    return TokenResponse(
        access_token=payload["access_token"],
        refresh_token=payload["refresh_token"],
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
    )
