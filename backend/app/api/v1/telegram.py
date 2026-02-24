"""Telegram bot account linking API."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User

router = APIRouter()


@router.post("/link-token")
async def generate_telegram_link_token(
    user: User = Depends(get_current_user),
):
    """Generate a short-lived token for linking Telegram account."""
    settings = get_settings()
    if not settings.telegram_bot_token:
        return {"error": "Telegram bot is not configured"}

    expire = datetime.now(timezone.utc) + timedelta(minutes=10)
    token = jwt.encode(
        {"sub": str(user.id), "type": "telegram_link", "exp": expire},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    # Deep link that opens the bot with the token as start param
    deep_link = f"https://t.me/SocyBaseBot?start={token}"
    return {"link": deep_link, "expires_in": 600}


@router.get("/status")
async def get_telegram_status(
    user: User = Depends(get_current_user),
):
    """Check if user has linked Telegram."""
    return {"linked": user.telegram_chat_id is not None}


@router.delete("/unlink")
async def unlink_telegram(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unlink Telegram account."""
    user.telegram_chat_id = None
    await db.flush()
    return {"message": "Telegram unlinked"}
