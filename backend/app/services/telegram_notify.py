"""Lightweight Telegram notification sender using raw HTTP API."""

import json
import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_job_completion_notification(
    chat_id: str, job, bot_token: str | None = None
) -> None:
    """Send a Telegram message about job completion/failure with action buttons."""
    settings = get_settings()
    token = bot_token or settings.telegram_bot_token
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


async def send_tb_order_notification(
    chat_id: str, order, service_name: str, bot_token: str | None = None
) -> None:
    """Send a Telegram message confirming a traffic bot order was placed."""
    settings = get_settings()
    token = bot_token or settings.telegram_bot_token
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
