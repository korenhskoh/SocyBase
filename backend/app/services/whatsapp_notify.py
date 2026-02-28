"""WhatsApp admin notification sender via Baileys microservice."""

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.system import SystemSetting

logger = logging.getLogger(__name__)

WHATSAPP_SETTINGS_KEY = "whatsapp_settings"


async def _get_whatsapp_config(db: AsyncSession | None = None) -> dict:
    """Read WhatsApp settings from DB, falling back to env vars."""
    db_settings = {}
    if db:
        try:
            result = await db.execute(
                select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
            )
            setting = result.scalar_one_or_none()
            if setting:
                db_settings = dict(setting.value)
        except Exception:
            pass

    env = get_settings()
    enabled = db_settings.get("whatsapp_enabled", True)
    return {
        "enabled": enabled,
        "service_url": db_settings.get("whatsapp_service_url") or env.whatsapp_service_url,
        "admin_number": db_settings.get("whatsapp_admin_number") or env.whatsapp_admin_number,
        # Per-notification toggles (default True)
        "notify_new_user": db_settings.get("notify_new_user", True),
        "notify_payment_approved": db_settings.get("notify_payment_approved", True),
        "notify_payment_completed": db_settings.get("notify_payment_completed", True),
        "notify_refund": db_settings.get("notify_refund", True),
        "notify_traffic_bot_order": db_settings.get("notify_traffic_bot_order", True),
        "notify_wallet_deposit": db_settings.get("notify_wallet_deposit", True),
    }


async def _send_whatsapp(message: str, db: AsyncSession | None = None) -> None:
    """Send a WhatsApp message to the admin number via the Baileys microservice."""
    config = await _get_whatsapp_config(db)
    if not config["enabled"] or not config["admin_number"]:
        return

    url = f"{config['service_url']}/send"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "to": config["admin_number"],
                "message": message,
            })
            if resp.status_code != 200:
                logger.warning(
                    "WhatsApp notify failed (HTTP %s): %s",
                    resp.status_code, resp.text[:200],
                )
    except Exception as e:
        logger.warning("Failed to send WhatsApp notification: %s", e)


async def notify_new_user(email: str, full_name: str, tenant_name: str, db: AsyncSession | None = None) -> None:
    config = await _get_whatsapp_config(db)
    if not config.get("notify_new_user", True):
        return
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    message = (
        f"*New User Registration*\n\n"
        f"Name: {full_name}\n"
        f"Email: {email}\n"
        f"Tenant: {tenant_name}\n"
        f"Time: {now}"
    )
    await _send_whatsapp(message, db)


async def notify_payment_approved(
    payment_id: str, amount_cents: int, currency: str, credits: int, method: str,
    db: AsyncSession | None = None,
) -> None:
    config = await _get_whatsapp_config(db)
    if not config.get("notify_payment_approved", True):
        return
    amount = f"{currency} {amount_cents / 100:.2f}"
    message = (
        f"*Payment Approved*\n\n"
        f"Payment: {payment_id[:8]}...\n"
        f"Amount: {amount}\n"
        f"Credits: {credits:,}\n"
        f"Method: {method}"
    )
    await _send_whatsapp(message, db)


async def notify_payment_completed(
    payment_id: str, amount_cents: int, currency: str, credits_added: int,
    db: AsyncSession | None = None,
) -> None:
    config = await _get_whatsapp_config(db)
    if not config.get("notify_payment_completed", True):
        return
    amount = f"{currency} {amount_cents / 100:.2f}"
    message = (
        f"*Stripe Payment Completed*\n\n"
        f"Payment: {payment_id[:8]}...\n"
        f"Amount: {amount}\n"
        f"Credits added: {credits_added:,}"
    )
    await _send_whatsapp(message, db)


async def notify_refund_processed(
    payment_id: str, amount_cents: int, currency: str, credits_deducted: int, method: str,
    db: AsyncSession | None = None,
) -> None:
    config = await _get_whatsapp_config(db)
    if not config.get("notify_refund", True):
        return
    amount = f"{currency} {amount_cents / 100:.2f}"
    message = (
        f"*Refund Processed*\n\n"
        f"Payment: {payment_id[:8]}...\n"
        f"Amount: {amount}\n"
        f"Credits deducted: {credits_deducted:,}\n"
        f"Method: {method}"
    )
    await _send_whatsapp(message, db)


async def notify_traffic_bot_order(
    user_email: str, service_name: str, quantity: int, total_cost: float, link: str,
    db: AsyncSession | None = None,
) -> None:
    config = await _get_whatsapp_config(db)
    if not config.get("notify_traffic_bot_order", True):
        return
    message = (
        f"*New Traffic Bot Order*\n\n"
        f"User: {user_email}\n"
        f"Service: {service_name}\n"
        f"Quantity: {quantity:,}\n"
        f"Cost: RM{total_cost:.4f}\n"
        f"Link: {link[:80]}"
    )
    await _send_whatsapp(message, db)


async def notify_wallet_deposit_request(
    user_email: str, amount: float, bank_reference: str,
    db: AsyncSession | None = None,
) -> None:
    config = await _get_whatsapp_config(db)
    if not config.get("notify_wallet_deposit", True):
        return
    message = (
        f"*Wallet Deposit Request*\n\n"
        f"User: {user_email}\n"
        f"Amount: RM{amount:.2f}\n"
        f"Reference: {bank_reference}"
    )
    await _send_whatsapp(message, db)
