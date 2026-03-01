"""Lightweight async email sender using global SMTP config."""

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_email(
    to: str, subject: str, body_text: str, body_html: str | None = None,
) -> bool:
    """Send an email via the global SMTP config. Returns True on success."""
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_user:
        logger.warning("SMTP not configured, skipping email to %s", to)
        return False

    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            start_tls=True,
        )
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)
        return False
