"""External API client for SMM panel with failover.

Primary: ttk888.com
Fallback: BulkProviders.com (if primary fails after retries)
"""

import asyncio
import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()

# Primary provider
PRIMARY_URL = _settings.traffic_bot_api_url
PRIMARY_KEY = _settings.traffic_bot_api_key

# Fallback provider
FALLBACK_URL = _settings.traffic_bot_fallback_api_url
FALLBACK_KEY = _settings.traffic_bot_fallback_api_key

TIMEOUT = 30.0
MAX_RETRIES = 3


async def _post_to(api_url: str, api_key: str, payload: dict, label: str) -> dict:
    """Send POST request to a specific provider with retry logic."""
    payload["key"] = api_key
    last_exc: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(api_url, data=payload)
                data = resp.json()
                if isinstance(data, dict) and data.get("error"):
                    raise ValueError(data["error"])
                return data
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            logger.warning("%s API attempt %d failed: %s", label, attempt + 1, exc)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(2 ** attempt)

    raise last_exc or RuntimeError(f"{label} API call failed")


async def _post(payload: dict) -> dict:
    """Send request to primary provider, auto-swap to fallback on failure."""
    # Try primary
    try:
        return await _post_to(PRIMARY_URL, PRIMARY_KEY, dict(payload), "Primary")
    except Exception as primary_exc:
        logger.error("Primary provider failed: %s", primary_exc)

    # Try fallback if configured
    if FALLBACK_URL and FALLBACK_KEY:
        logger.info("Switching to fallback provider (%s)", FALLBACK_URL)
        try:
            return await _post_to(FALLBACK_URL, FALLBACK_KEY, dict(payload), "Fallback")
        except Exception as fallback_exc:
            logger.error("Fallback provider also failed: %s", fallback_exc)
            raise fallback_exc
    else:
        raise primary_exc


async def fetch_services() -> list[dict]:
    """Fetch the full service list from API."""
    return await _post({"action": "services"})


async def add_order(service_id: int, link: str, quantity: int) -> dict:
    """Place a new order. Returns {"order": <id>}."""
    return await _post({
        "action": "add",
        "service": service_id,
        "link": link,
        "quantity": quantity,
    })


async def get_order_status(order_id: int) -> dict:
    """Get status of an order. Returns charge, start_count, status, remains, currency."""
    return await _post({
        "action": "status",
        "order": order_id,
    })


async def get_multiple_order_status(order_ids: list[int]) -> dict:
    """Get status of multiple orders at once."""
    return await _post({
        "action": "status",
        "orders": ",".join(str(oid) for oid in order_ids),
    })


async def cancel_order(order_id: int) -> dict:
    """Cancel an order."""
    return await _post({
        "action": "cancel",
        "order": order_id,
    })


async def refill_order(order_id: int) -> dict:
    """Request refill for an order."""
    return await _post({
        "action": "refill",
        "order": order_id,
    })


async def get_balance() -> dict:
    """Get API account balance. Returns {"balance": "xxx", "currency": "USD"}."""
    return await _post({"action": "balance"})
