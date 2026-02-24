"""Lightweight Telegram notification sender using raw HTTP API."""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_job_completion_notification(
    chat_id: str, job, bot_token: str | None = None
) -> None:
    """Send a Telegram message about job completion/failure."""
    settings = get_settings()
    token = bot_token or settings.telegram_bot_token
    if not token:
        return

    if job.status == "completed":
        text = (
            f"<b>Job completed!</b>\n\n"
            f"Profiles extracted: <b>{job.result_row_count}</b>\n"
            f"Credits used: <b>{job.credits_used}</b>\n\n"
            f"View results in your dashboard."
        )
    else:
        text = (
            f"<b>Job failed</b>\n\n"
            f"Error: {job.error_message or 'Unknown error'}\n\n"
            f"Check your dashboard for details."
        )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            })
    except Exception as e:
        logger.warning(f"Failed to send Telegram notification to {chat_id}: {e}")
