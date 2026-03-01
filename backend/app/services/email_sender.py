"""Lightweight async email sender.

Resolves email sending via:
1. Resend HTTP API (if RESEND_API_KEY is set — works on Railway)
2. SMTP from env vars or tenant DB settings (fallback)
"""

import logging
from email.message import EmailMessage

import aiosmtplib
import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def _send_via_resend(
    to: str, subject: str, body_text: str, body_html: str | None,
    from_email: str, api_key: str,
) -> bool:
    """Send email via Resend HTTP API."""
    payload: dict = {
        "from": from_email,
        "to": [to],
        "subject": subject,
    }
    if body_html:
        payload["html"] = body_html
    else:
        payload["text"] = body_text

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code in (200, 201):
            logger.info("Email sent via Resend to %s", to)
            return True
        else:
            logger.error("Resend API error (%d): %s", resp.status_code, resp.text)
            return False
    except Exception as e:
        logger.error("Resend request failed: %s", e)
        return False


async def _resolve_smtp_config() -> dict | None:
    """Return SMTP config dict, trying env vars first then tenant DB settings."""
    settings = get_settings()

    # 1. Env-var config
    if settings.smtp_host and settings.smtp_user:
        return {
            "hostname": settings.smtp_host,
            "port": settings.smtp_port,
            "username": settings.smtp_user,
            "password": settings.smtp_password,
            "email_from": settings.email_from,
        }

    # 2. Fallback: scan all tenants for one with email settings configured
    try:
        from sqlalchemy import select
        from app.database import async_session
        from app.models.tenant import Tenant

        async with async_session() as db:
            result = await db.execute(select(Tenant))
            tenants = result.scalars().all()
            for tenant in tenants:
                email_cfg = (tenant.settings or {}).get("email", {})
                if email_cfg.get("smtp_host") and email_cfg.get("smtp_user"):
                    return {
                        "hostname": email_cfg["smtp_host"],
                        "port": email_cfg.get("smtp_port", 587),
                        "username": email_cfg["smtp_user"],
                        "password": email_cfg.get("smtp_password", ""),
                        "email_from": email_cfg.get("email_from", settings.email_from),
                    }
    except Exception:
        logger.warning("Failed to load tenant SMTP config from DB", exc_info=True)

    return None


def _resolve_from_email() -> str:
    """Get the sender email address from env or tenant DB (sync-safe, best effort)."""
    return get_settings().email_from


async def send_email(
    to: str, subject: str, body_text: str, body_html: str | None = None,
) -> bool:
    """Send an email. Tries Resend HTTP API first, then SMTP as fallback."""
    settings = get_settings()

    # ── Try Resend first (works on Railway where SMTP is blocked) ──
    if settings.resend_api_key:
        # Use Resend default testing sender if no custom domain configured
        smtp_cfg = await _resolve_smtp_config()
        from_email = (smtp_cfg or {}).get("email_from", settings.email_from)
        # Resend requires verified domain; fall back to their testing sender
        if not from_email or "@gmail.com" in from_email or from_email == "noreply@socybase.com":
            from_email = "SocyBase <onboarding@resend.dev>"
        return await _send_via_resend(to, subject, body_text, body_html, from_email, settings.resend_api_key)

    # ── Fallback: SMTP ──
    cfg = await _resolve_smtp_config()
    if not cfg:
        logger.warning("No email config (Resend or SMTP), skipping email to %s", to)
        return False

    msg = EmailMessage()
    msg["From"] = cfg["email_from"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    port = cfg["port"]
    use_tls = port == 465
    start_tls = not use_tls

    try:
        await aiosmtplib.send(
            msg,
            hostname=cfg["hostname"],
            port=port,
            username=cfg["username"],
            password=cfg["password"],
            use_tls=use_tls,
            start_tls=start_tls,
            timeout=30,
        )
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        return False
