"""Lightweight async email sender.

Resolves SMTP config from:
1. Global env-var settings (SMTP_HOST, etc.)
2. Fallback: first tenant's DB email settings (for single-tenant / bot usage)
"""

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import get_settings

logger = logging.getLogger(__name__)


async def _resolve_smtp_config() -> dict | None:
    """Return SMTP config dict, trying env vars first then tenant DB settings."""
    settings = get_settings()

    # 1. Env-var config
    if settings.smtp_host and settings.smtp_user:
        logger.info("Using env-var SMTP config (host=%s, user=%s)", settings.smtp_host, settings.smtp_user)
        return {
            "hostname": settings.smtp_host,
            "port": settings.smtp_port,
            "username": settings.smtp_user,
            "password": settings.smtp_password,
            "email_from": settings.email_from,
        }

    logger.info("Env-var SMTP not set (host=%r, user=%r), trying tenant DB...", settings.smtp_host, settings.smtp_user)

    # 2. Fallback: tenant DB settings
    try:
        from sqlalchemy import select
        from app.database import async_session
        from app.models.tenant import Tenant

        async with async_session() as db:
            result = await db.execute(select(Tenant).limit(1))
            tenant = result.scalar_one_or_none()
            if tenant:
                email_cfg = (tenant.settings or {}).get("email", {})
                logger.info("Tenant email config keys: %s", list(email_cfg.keys()) if email_cfg else "none")
                if email_cfg.get("smtp_host") and email_cfg.get("smtp_user"):
                    logger.info("Using tenant DB SMTP config (host=%s, user=%s)", email_cfg["smtp_host"], email_cfg["smtp_user"])
                    return {
                        "hostname": email_cfg["smtp_host"],
                        "port": email_cfg.get("smtp_port", 587),
                        "username": email_cfg["smtp_user"],
                        "password": email_cfg.get("smtp_password", ""),
                        "email_from": email_cfg.get("email_from", settings.email_from),
                    }
                else:
                    logger.warning("Tenant email config incomplete: smtp_host=%r, smtp_user=%r",
                                   email_cfg.get("smtp_host"), email_cfg.get("smtp_user"))
            else:
                logger.warning("No tenant found in DB")
    except Exception:
        logger.warning("Failed to load tenant SMTP config from DB", exc_info=True)

    return None


async def send_email(
    to: str, subject: str, body_text: str, body_html: str | None = None,
) -> bool:
    """Send an email using resolved SMTP config. Returns True on success."""
    cfg = await _resolve_smtp_config()
    if not cfg:
        logger.warning("SMTP not configured, skipping email to %s", to)
        return False

    msg = EmailMessage()
    msg["From"] = cfg["email_from"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=cfg["hostname"],
            port=cfg["port"],
            username=cfg["username"],
            password=cfg["password"],
            start_tls=True,
        )
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        return False
