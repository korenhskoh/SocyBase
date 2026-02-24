from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.dependencies import get_current_user, get_current_admin
from app.models.user import User
from app.models.tenant import Tenant
from app.schemas.tenant_settings import (
    TenantSettingsResponse,
    UpdateTenantSettingsRequest,
    EmailSettingsResponse,
    TelegramSettingsResponse,
)

router = APIRouter()

MASKED = "********"


def _mask_settings(settings: dict) -> TenantSettingsResponse:
    """Mask sensitive fields before returning to the client."""
    email_data = settings.get("email")
    telegram_data = settings.get("telegram")

    masked_email = None
    if email_data:
        masked_email = EmailSettingsResponse(
            smtp_host=email_data.get("smtp_host", ""),
            smtp_port=email_data.get("smtp_port", 587),
            smtp_user=email_data.get("smtp_user", ""),
            smtp_password=MASKED,
            email_from=email_data.get("email_from", ""),
        )

    masked_telegram = None
    if telegram_data:
        masked_telegram = TelegramSettingsResponse(
            bot_token=MASKED,
            notification_chat_id=telegram_data.get("notification_chat_id", ""),
        )

    return TenantSettingsResponse(email=masked_email, telegram=masked_telegram)


@router.get("", response_model=TenantSettingsResponse)
async def get_tenant_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get tenant settings. Any authenticated user can view (masked)."""
    result = await db.execute(
        select(Tenant).where(Tenant.id == user.tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    return _mask_settings(tenant.settings or {})


@router.put("", response_model=TenantSettingsResponse)
async def update_tenant_settings(
    data: UpdateTenantSettingsRequest,
    user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update tenant settings. Only tenant_admin or super_admin."""
    result = await db.execute(
        select(Tenant).where(Tenant.id == user.tenant_id)
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    current = dict(tenant.settings or {})

    if data.email is not None:
        email_dict = data.email.model_dump()
        # Preserve existing password if client sends the masked placeholder back
        existing_email = current.get("email", {})
        if email_dict.get("smtp_password") == MASKED and existing_email.get("smtp_password"):
            email_dict["smtp_password"] = existing_email["smtp_password"]
        current["email"] = email_dict

    if data.telegram is not None:
        telegram_dict = data.telegram.model_dump()
        # Preserve existing bot token if client sends the masked placeholder back
        existing_telegram = current.get("telegram", {})
        if telegram_dict.get("bot_token") == MASKED and existing_telegram.get("bot_token"):
            telegram_dict["bot_token"] = existing_telegram["bot_token"]
        current["telegram"] = telegram_dict

    tenant.settings = current
    await db.flush()

    return _mask_settings(tenant.settings)
