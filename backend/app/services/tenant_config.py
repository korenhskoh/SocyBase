"""Resolve per-tenant configuration with fallback to global settings."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.tenant import Tenant


async def get_telegram_config(db: AsyncSession, tenant_id: UUID) -> dict:
    """Return telegram config for a tenant, falling back to global settings."""
    settings = get_settings()
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    tenant_tg = (tenant.settings or {}).get("telegram", {}) if tenant else {}

    return {
        "bot_token": tenant_tg.get("bot_token") or settings.telegram_bot_token,
        "notification_chat_id": tenant_tg.get("notification_chat_id"),
    }


async def get_email_config(db: AsyncSession, tenant_id: UUID) -> dict:
    """Return SMTP config for a tenant, falling back to global settings."""
    settings = get_settings()
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()

    tenant_email = (tenant.settings or {}).get("email", {}) if tenant else {}

    return {
        "smtp_host": tenant_email.get("smtp_host") or settings.smtp_host,
        "smtp_port": tenant_email.get("smtp_port") or settings.smtp_port,
        "smtp_user": tenant_email.get("smtp_user") or settings.smtp_user,
        "smtp_password": tenant_email.get("smtp_password") or settings.smtp_password,
        "email_from": tenant_email.get("email_from") or settings.email_from,
    }
