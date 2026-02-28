"""External API client for BulkProviders.com SMM panel."""
import logging
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()

API_URL = _settings.traffic_bot_api_url
API_KEY = _settings.traffic_bot_api_key

TIMEOUT = 30.0
MAX_RETRIES = 3


async def _post(payload: dict) -> dict:
    """Send POST request to BulkProviders API with retry logic."""
    payload["key"] = API_KEY
    last_exc: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(API_URL, data=payload)
                data = resp.json()
                if isinstance(data, dict) and data.get("error"):
                    raise ValueError(data["error"])
                return data
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            logger.warning("BulkProviders API attempt %d failed: %s", attempt + 1, exc)
            if attempt < MAX_RETRIES - 1:
                import asyncio
                await asyncio.sleep(2 ** attempt)

    raise last_exc or RuntimeError("BulkProviders API call failed")


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
