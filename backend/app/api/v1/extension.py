"""Facebook cookie management API for browser-based scraping fallback."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.fb_cookie_session import FBCookieSession
from app.models.user import User
from app.services.meta_api import MetaAPIService

logger = logging.getLogger(__name__)
router = APIRouter()


class SaveCookiesRequest(BaseModel):
    cookies_json: str


@router.post("/cookies")
async def save_cookies(
    body: SaveCookiesRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save Facebook login cookies for browser-based scraping."""
    # Parse and validate JSON
    try:
        cookies = json.loads(body.cookies_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format")

    if not isinstance(cookies, list):
        raise HTTPException(status_code=400, detail="Cookies must be a JSON array")

    # Validate required cookies (c_user and xs minimum for FB session)
    cookie_names = {c.get("name", c.get("Name", "")) for c in cookies if isinstance(c, dict)}
    missing = {"c_user", "xs"} - cookie_names
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required cookies: {', '.join(sorted(missing))}. Need at least c_user and xs.",
        )

    # Extract fb_user_id from c_user cookie
    fb_user_id = None
    for c in cookies:
        if isinstance(c, dict) and c.get("name", c.get("Name", "")) == "c_user":
            fb_user_id = str(c.get("value", c.get("Value", "")))
            break

    # Encrypt cookies
    meta = MetaAPIService()
    encrypted = meta.encrypt_token(json.dumps(cookies))

    # Upsert
    result = await db.execute(
        select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
    )
    session = result.scalar_one_or_none()

    if session:
        session.cookies_encrypted = encrypted
        session.fb_user_id = fb_user_id
        session.user_id = user.id
        session.is_valid = True
        session.last_validated_at = None
    else:
        session = FBCookieSession(
            tenant_id=user.tenant_id,
            user_id=user.id,
            cookies_encrypted=encrypted,
            fb_user_id=fb_user_id,
        )
        db.add(session)

    await db.commit()
    logger.info("Saved FB cookies for tenant %s (user: %s)", user.tenant_id, fb_user_id)
    return {"success": True, "fb_user_id": fb_user_id, "cookie_count": len(cookies)}


@router.get("/status")
async def get_cookie_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if tenant has saved Facebook cookies."""
    result = await db.execute(
        select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        return {"has_cookies": False}

    return {
        "has_cookies": True,
        "fb_user_id": session.fb_user_id,
        "is_valid": session.is_valid,
        "last_validated_at": session.last_validated_at.isoformat() if session.last_validated_at else None,
    }


@router.delete("/cookies")
async def delete_cookies(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove saved Facebook cookies."""
    result = await db.execute(
        select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
    )
    session = result.scalar_one_or_none()

    if session:
        await db.delete(session)
        await db.commit()
        logger.info("Deleted FB cookies for tenant %s", user.tenant_id)

    return {"success": True}
