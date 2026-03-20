"""Lightweight Telegram notification sender using raw HTTP API."""

import json
import logging

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.database import async_session
from app.models.system import SystemSetting

logger = logging.getLogger(__name__)

TELEGRAM_SETTINGS_KEY = "telegram_settings"


async def get_telegram_bot_token() -> str | None:
    """Get bot token from DB settings, falling back to env var."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(SystemSetting).where(
                    SystemSetting.key == TELEGRAM_SETTINGS_KEY
                )
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value.get("bot_token"):
                return setting.value["bot_token"]
    except Exception:
        pass
    return get_settings().telegram_bot_token or None


async def get_telegram_notification_chat_id() -> str | None:
    """Get notification chat ID from DB settings."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(SystemSetting).where(
                    SystemSetting.key == TELEGRAM_SETTINGS_KEY
                )
            )
            setting = result.scalar_one_or_none()
            if setting:
                return setting.value.get("notification_chat_id")
    except Exception:
        pass
    return None


async def send_job_completion_notification(
    chat_id: str, job, bot_token: str | None = None
) -> None:
    """Send a Telegram message about job completion/failure with action buttons."""
    token = bot_token or await get_telegram_bot_token()
    if not token:
        return

    short_id = str(job.id)[:8]
    jtype = "Discovery" if getattr(job, "job_type", None) == "post_discovery" else "Comments"

    if job.status == "completed":
        text = (
            f"\u2705 <b>Job Completed!</b>\n\n"
            f"<b>Job:</b> <code>{short_id}...</code> ({jtype})\n"
            f"<b>Profiles:</b> {job.result_row_count or 0:,}\n"
            f"<b>Credits used:</b> {job.credits_used or 0:,}\n\n"
            f"Your results are ready for download."
        )
        reply_markup = {
            "inline_keyboard": [
                [{"text": "\U0001F4CA View Details", "callback_data": f"job:{job.id}"}],
                [{"text": "\U0001F4CB All Jobs", "callback_data": "back:jobs"}],
            ]
        }
    else:
        text = (
            f"\u274C <b>Job Failed</b>\n\n"
            f"<b>Job:</b> <code>{short_id}...</code> ({jtype})\n"
            f"<b>Error:</b> {(job.error_message or 'Unknown error')[:200]}\n"
        )
        # Add retry button if checkpoint available
        pipeline_state = (getattr(job, "error_details", None) or {}).get("pipeline_state")
        buttons = [[{"text": "\U0001F4CA View Details", "callback_data": f"job:{job.id}"}]]
        if pipeline_state:
            buttons.insert(0, [{"text": "\U0001F504 Retry Job", "callback_data": f"action:resume:{job.id}"}])
        buttons.append([{"text": "\U0001F4CB All Jobs", "callback_data": "back:jobs"}])
        reply_markup = {"inline_keyboard": buttons}

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "reply_markup": json.dumps(reply_markup),
            })
    except Exception as e:
        logger.warning(f"Failed to send Telegram notification to {chat_id}: {e}")


async def send_admin_error_alert(
    job, error_message: str, bot_token: str | None = None
) -> None:
    """Send a Telegram alert to all super_admin users when a job fails with a critical error."""
    token = bot_token or await get_telegram_bot_token()
    if not token:
        return

    try:
        from app.models.user import User

        async with async_session() as db:
            result = await db.execute(
                select(User).where(
                    User.role == "super_admin",
                    User.telegram_chat_id.isnot(None),
                )
            )
            admins = result.scalars().all()
            if not admins:
                return

            # Look up job owner
            job_owner = None
            if hasattr(job, "user_id") and job.user_id:
                owner_result = await db.execute(
                    select(User).where(User.id == job.user_id)
                )
                job_owner = owner_result.scalar_one_or_none()

            short_id = str(job.id)[:8]
            jtype = "Discovery" if getattr(job, "job_type", None) == "post_discovery" else "Comments"
            owner_name = (job_owner.full_name or job_owner.email) if job_owner else "Unknown"

            is_401 = "401" in error_message or "Unauthorized" in error_message
            is_timeout = any(t in error_message for t in ["Timeout", "ReadTimeout", "ConnectTimeout"])

            if is_401:
                alert_type = "API Key Quota Exhausted"
                icon = "\U0001F6A8"
            elif is_timeout:
                alert_type = "API Timeout"
                icon = "\u23F0"
            else:
                alert_type = "Pipeline Error"
                icon = "\u26A0\uFE0F"

            text = (
                f"{icon} <b>Admin Alert: {alert_type}</b>\n\n"
                f"<b>Job:</b> <code>{short_id}...</code> ({jtype})\n"
                f"<b>User:</b> {owner_name}\n"
                f"<b>Input:</b> {getattr(job, 'input_value', 'N/A')}\n"
                f"<b>Error:</b> {error_message[:300]}\n"
            )

            url = f"https://api.telegram.org/bot{token}/sendMessage"
            async with httpx.AsyncClient(timeout=10) as http:
                for admin in admins:
                    try:
                        await http.post(url, json={
                            "chat_id": admin.telegram_chat_id,
                            "text": text,
                            "parse_mode": "HTML",
                        })
                    except Exception as e:
                        logger.warning(f"Failed to send admin alert to {admin.email}: {e}")

    except Exception as e:
        logger.warning(f"Failed to send admin error alert: {e}")


async def send_credit_warning_notification(
    chat_id: str, balance_after: int, credits_used: int, job=None,
    bot_token: str | None = None,
) -> None:
    """Send a Telegram warning when credit balance drops below threshold."""
    token = bot_token or await get_telegram_bot_token()
    if not token:
        return

    if balance_after == 0:
        icon = "\U0001F6A8"
        title = "Credits Depleted!"
        body = "Your credit balance has reached <b>0</b>. New scraping jobs will fail until you top up."
    elif balance_after < 50:
        icon = "\u26A0\uFE0F"
        title = "Low Credit Balance"
        body = f"Your balance is now <b>{balance_after:,}</b> credits. Consider topping up to avoid job interruptions."
    else:
        return  # No warning needed

    job_line = ""
    if job:
        short_id = str(job.id)[:8]
        job_line = f"\n<b>After job:</b> <code>{short_id}...</code> (used {credits_used:,} credits)"

    text = f"{icon} <b>{title}</b>\n{job_line}\n\n{body}"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            })
    except Exception as e:
        logger.warning(f"Failed to send credit warning to {chat_id}: {e}")


async def send_job_started_notification(
    chat_id: str, job, bot_token: str | None = None
) -> None:
    """Send a Telegram message when a scraping job starts running."""
    token = bot_token or await get_telegram_bot_token()
    if not token:
        return

    short_id = str(job.id)[:8]
    jtype = "Discovery" if getattr(job, "job_type", None) == "post_discovery" else "Comments"
    input_val = getattr(job, "input_value", "N/A") or "N/A"
    if len(input_val) > 60:
        input_val = input_val[:57] + "..."

    text = (
        f"\U0001F680 <b>Job Started</b>\n\n"
        f"<b>Job:</b> <code>{short_id}...</code> ({jtype})\n"
        f"<b>Input:</b> {input_val}\n\n"
        f"You'll be notified when it completes."
    )
    reply_markup = {
        "inline_keyboard": [
            [{"text": "\U0001F4CA View Details", "callback_data": f"job:{job.id}"}],
        ]
    }

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "reply_markup": json.dumps(reply_markup),
            })
    except Exception as e:
        logger.warning(f"Failed to send job started notification to {chat_id}: {e}")


async def send_tb_order_notification(
    chat_id: str, order, service_name: str, bot_token: str | None = None
) -> None:
    """Send a Telegram message confirming a traffic bot order was placed."""
    token = bot_token or await get_telegram_bot_token()
    if not token:
        return

    short_id = str(order.id)[:8]
    status_icons = {
        "pending": "\u23F3", "processing": "\U0001F504", "in_progress": "\U0001F504",
        "completed": "\u2705", "failed": "\u274C", "cancelled": "\u26D4",
    }
    icon = status_icons.get(order.status, "\u26AA")

    text = (
        f"\U0001F4E6 <b>Traffic Bot Order Placed</b>\n\n"
        f"<b>Order:</b> <code>{short_id}...</code>\n"
        f"<b>Service:</b> {service_name}\n"
        f"<b>Quantity:</b> {order.quantity:,}\n"
        f"<b>Cost:</b> RM{float(order.total_cost):.4f}\n"
        f"<b>Status:</b> {icon} {order.status.upper()}\n\n"
        f"Your order is being processed."
    )
    reply_markup = {
        "inline_keyboard": [
            [{"text": "\U0001F4CA View Order", "callback_data": f"tb_order:{order.id}"}],
            [{"text": "\U0001F4CB My Orders", "callback_data": "tb_back:orders"}],
        ]
    }

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "reply_markup": json.dumps(reply_markup),
            })
    except Exception as e:
        logger.warning(f"Failed to send TB Telegram notification to {chat_id}: {e}")


async def send_live_engage_notification(
    chat_id: str, session, event: str, details: str = "", bot_token: str | None = None
) -> None:
    """Send Telegram notification for livestream engagement events."""
    token = bot_token or await get_telegram_bot_token()
    if not token:
        return

    short_id = str(session.id)[:8]
    title = session.title or session.post_id

    icons = {
        "started": "\U0001F534",    # red circle
        "completed": "\u2705",      # check
        "stopped": "\u23F9",        # stop
        "paused": "\u23F8",         # pause
        "resumed": "\u25B6",        # play
        "error_spike": "\u26A0",    # warning
        "trigger": "\U0001F3AF",    # target
    }
    icon = icons.get(event, "\U0001F4E2")

    stats = ""
    if hasattr(session, "total_comments_posted"):
        stats = (
            f"\n<b>Posted:</b> {session.total_comments_posted or 0}"
            f" | <b>Errors:</b> {session.total_errors or 0}"
            f" | <b>Monitored:</b> {session.comments_monitored or 0}"
        )

    text = (
        f"{icon} <b>Livestream: {event.upper()}</b>\n\n"
        f"<b>Session:</b> {title}\n"
        f"<b>ID:</b> <code>{short_id}...</code>"
        f"{stats}"
        f"\n{details}" if details else
        f"{icon} <b>Livestream: {event.upper()}</b>\n\n"
        f"<b>Session:</b> {title}\n"
        f"<b>ID:</b> <code>{short_id}...</code>"
        f"{stats}"
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
        logger.warning(f"Failed to send livestream Telegram notification: {e}")
