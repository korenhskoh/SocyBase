import asyncio
import re
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException, status
from app.models.tenant import Tenant
from app.models.user import User
from app.models.credit import CreditBalance
from app.utils.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse
from app.config import get_settings
from app.services.whatsapp_notify import notify_new_user

settings = get_settings()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug


async def register_user(data: RegisterRequest, db: AsyncSession) -> tuple[User, TokenResponse]:
    # Check if email already exists
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    # Create tenant
    slug = _slugify(data.tenant_name)
    # Ensure slug is unique
    slug_check = await db.execute(select(Tenant).where(Tenant.slug == slug))
    if slug_check.scalar_one_or_none():
        import uuid
        slug = f"{slug}-{str(uuid.uuid4())[:8]}"

    tenant = Tenant(name=data.tenant_name, slug=slug)
    db.add(tenant)
    await db.flush()

    # Create user
    user = User(
        tenant_id=tenant.id,
        email=data.email,
        password_hash=await asyncio.to_thread(hash_password, data.password),
        full_name=data.full_name,
        role="tenant_admin",
        language=data.language,
    )
    db.add(user)

    # Create credit balance for tenant
    credit_balance = CreditBalance(tenant_id=tenant.id, balance=0)
    db.add(credit_balance)

    await db.flush()

    # Generate tokens
    tokens = _create_tokens(user)

    await notify_new_user(user.email, user.full_name or "", data.tenant_name, db)

    return user, tokens


async def login_user(data: LoginRequest, db: AsyncSession) -> tuple[User, TokenResponse]:
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not await asyncio.to_thread(verify_password, data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # Update last login
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()

    tokens = _create_tokens(user)
    return user, tokens


async def refresh_tokens(refresh_token: str, db: AsyncSession) -> TokenResponse:
    payload = decode_token(refresh_token)

    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return _create_tokens(user)


def _create_tokens(user: User) -> TokenResponse:
    token_data = {"sub": str(user.id), "tenant_id": str(user.tenant_id), "role": user.role}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )
