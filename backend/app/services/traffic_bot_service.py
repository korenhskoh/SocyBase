"""Business logic for Traffic Bot: wallet management, orders, service sync."""
import logging
import uuid
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.traffic_bot import (
    TrafficBotWallet, TrafficBotTransaction,
    TrafficBotService, TrafficBotOrder,
)
from app.services import traffic_bot_api

logger = logging.getLogger(__name__)


# ── Wallet ──────────────────────────────────────────────────

async def get_or_create_wallet(db: AsyncSession, tenant_id: uuid.UUID) -> TrafficBotWallet:
    result = await db.execute(
        select(TrafficBotWallet).where(TrafficBotWallet.tenant_id == tenant_id)
    )
    wallet = result.scalar_one_or_none()
    if wallet is None:
        wallet = TrafficBotWallet(tenant_id=tenant_id, balance=Decimal("0"))
        db.add(wallet)
        await db.flush()
    return wallet


async def deposit(
    db: AsyncSession, tenant_id: uuid.UUID, amount: float, description: str = "Admin deposit"
) -> TrafficBotTransaction:
    wallet = await get_or_create_wallet(db, tenant_id)
    wallet.balance = Decimal(str(wallet.balance)) + Decimal(str(amount))
    txn = TrafficBotTransaction(
        tenant_id=tenant_id,
        type="deposit",
        amount=Decimal(str(amount)),
        balance_after=wallet.balance,
        description=description,
    )
    db.add(txn)
    await db.flush()
    return txn


async def _deduct(
    db: AsyncSession, tenant_id: uuid.UUID, amount: Decimal,
    order_id: uuid.UUID | None = None,
) -> TrafficBotTransaction:
    wallet = await get_or_create_wallet(db, tenant_id)
    new_balance = Decimal(str(wallet.balance)) - amount
    if new_balance < 0:
        raise ValueError("Insufficient wallet balance")
    wallet.balance = new_balance
    txn = TrafficBotTransaction(
        tenant_id=tenant_id,
        type="order_payment",
        amount=-amount,
        balance_after=new_balance,
        description=f"Order payment",
        reference_id=order_id,
    )
    db.add(txn)
    await db.flush()
    return txn


async def _refund(
    db: AsyncSession, tenant_id: uuid.UUID, amount: Decimal,
    order_id: uuid.UUID | None = None,
) -> TrafficBotTransaction:
    wallet = await get_or_create_wallet(db, tenant_id)
    wallet.balance = Decimal(str(wallet.balance)) + amount
    txn = TrafficBotTransaction(
        tenant_id=tenant_id,
        type="refund",
        amount=amount,
        balance_after=wallet.balance,
        description="Order refund",
        reference_id=order_id,
    )
    db.add(txn)
    await db.flush()
    return txn


async def get_transactions(
    db: AsyncSession, tenant_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> list[TrafficBotTransaction]:
    result = await db.execute(
        select(TrafficBotTransaction)
        .where(TrafficBotTransaction.tenant_id == tenant_id)
        .order_by(TrafficBotTransaction.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


# ── Services ────────────────────────────────────────────────

async def sync_services(db: AsyncSession) -> int:
    """Fetch services from BulkProviders API and upsert into DB. Returns count."""
    raw_services = await traffic_bot_api.fetch_services()
    if not isinstance(raw_services, list):
        raise ValueError(f"Unexpected API response: {type(raw_services)}")

    count = 0
    for svc in raw_services:
        stmt = pg_insert(TrafficBotService).values(
            id=uuid.uuid4(),
            external_service_id=int(svc["service"]),
            name=svc.get("name", ""),
            category=svc.get("category", "Other"),
            type=svc.get("type", "Default"),
            rate=Decimal(str(svc.get("rate", "0"))),
            min_quantity=int(svc.get("min", 10)),
            max_quantity=int(svc.get("max", 1000000)),
        ).on_conflict_do_update(
            index_elements=["external_service_id"],
            set_={
                "name": svc.get("name", ""),
                "category": svc.get("category", "Other"),
                "type": svc.get("type", "Default"),
                "rate": Decimal(str(svc.get("rate", "0"))),
                "min_quantity": int(svc.get("min", 10)),
                "max_quantity": int(svc.get("max", 1000000)),
                "updated_at": datetime.now(timezone.utc),
            },
        )
        await db.execute(stmt)
        count += 1

    await db.flush()
    return count


async def list_services(
    db: AsyncSession, enabled_only: bool = True, category: str | None = None,
) -> list[TrafficBotService]:
    q = select(TrafficBotService)
    if enabled_only:
        q = q.where(TrafficBotService.is_enabled == True)
    if category:
        q = q.where(TrafficBotService.category == category)
    q = q.order_by(TrafficBotService.sort_order, TrafficBotService.category, TrafficBotService.name)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_service(db: AsyncSession, service_id: uuid.UUID) -> TrafficBotService | None:
    result = await db.execute(
        select(TrafficBotService).where(TrafficBotService.id == service_id)
    )
    return result.scalar_one_or_none()


async def get_categories(db: AsyncSession) -> list[str]:
    result = await db.execute(
        select(TrafficBotService.category)
        .where(TrafficBotService.is_enabled == True)
        .distinct()
        .order_by(TrafficBotService.category)
    )
    return [row[0] for row in result.all()]


def calculate_price(rate: float, quantity: int, fee_pct: float) -> dict:
    """Calculate total price: base_cost + fee."""
    base_cost = Decimal(str(rate)) * Decimal(str(quantity)) / Decimal("1000")
    fee_amount = base_cost * Decimal(str(fee_pct)) / Decimal("100")
    total = base_cost + fee_amount
    return {
        "base_cost": float(base_cost.quantize(Decimal("0.0001"))),
        "fee_amount": float(fee_amount.quantize(Decimal("0.0001"))),
        "total_cost": float(total.quantize(Decimal("0.0001"))),
    }


# ── Orders ──────────────────────────────────────────────────

async def place_order(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    service_id: uuid.UUID,
    link: str,
    quantity: int,
) -> TrafficBotOrder:
    service = await get_service(db, service_id)
    if not service:
        raise ValueError("Service not found")
    if not service.is_enabled:
        raise ValueError("Service is currently disabled")
    if quantity < service.min_quantity or quantity > service.max_quantity:
        raise ValueError(f"Quantity must be between {service.min_quantity} and {service.max_quantity}")

    pricing = calculate_price(float(service.rate), quantity, float(service.fee_pct))
    total_cost = Decimal(str(pricing["total_cost"]))

    # Deduct wallet
    await _deduct(db, tenant_id, total_cost)

    # Create order record
    order = TrafficBotOrder(
        tenant_id=tenant_id,
        user_id=user_id,
        service_id=service_id,
        link=link,
        quantity=quantity,
        base_cost=Decimal(str(pricing["base_cost"])),
        fee_amount=Decimal(str(pricing["fee_amount"])),
        total_cost=total_cost,
        status="pending",
    )
    db.add(order)
    await db.flush()

    # Call external API
    try:
        api_resp = await traffic_bot_api.add_order(
            service_id=service.external_service_id,
            link=link,
            quantity=quantity,
        )
        order.external_order_id = int(api_resp.get("order", 0))
        order.status = "processing"
    except Exception as exc:
        logger.error("Failed to place order via API: %s", exc)
        order.status = "failed"
        order.error_message = str(exc)
        # Refund wallet
        await _refund(db, tenant_id, total_cost, order.id)

    await db.flush()
    return order


async def refresh_order_status(db: AsyncSession, order: TrafficBotOrder) -> TrafficBotOrder:
    """Poll the external API and update local order status."""
    if not order.external_order_id:
        return order

    try:
        data = await traffic_bot_api.get_order_status(order.external_order_id)
        new_status = str(data.get("status", "")).lower().replace(" ", "_")
        # Map API statuses
        status_map = {
            "pending": "pending",
            "processing": "processing",
            "in progress": "in_progress",
            "in_progress": "in_progress",
            "completed": "completed",
            "partial": "partial",
            "canceled": "cancelled",
            "cancelled": "cancelled",
            "refunded": "refunded",
        }
        mapped = status_map.get(new_status, order.status)
        order.status = mapped
        order.start_count = data.get("start_count")
        order.remains = data.get("remains")

        # Auto-refund on cancelled/partial if applicable
        if mapped in ("cancelled", "refunded") and order.status not in ("cancelled", "refunded"):
            await _refund(db, order.tenant_id, Decimal(str(order.total_cost)), order.id)

    except Exception as exc:
        logger.warning("Failed to refresh order %s: %s", order.id, exc)

    await db.flush()
    return order


async def list_orders(
    db: AsyncSession, tenant_id: uuid.UUID,
    status: str | None = None,
    limit: int = 50, offset: int = 0,
) -> tuple[list[TrafficBotOrder], int]:
    q = select(TrafficBotOrder).where(TrafficBotOrder.tenant_id == tenant_id).options(selectinload(TrafficBotOrder.service))
    count_q = select(func.count()).select_from(TrafficBotOrder).where(TrafficBotOrder.tenant_id == tenant_id)
    if status:
        q = q.where(TrafficBotOrder.status == status)
        count_q = count_q.where(TrafficBotOrder.status == status)
    q = q.order_by(TrafficBotOrder.created_at.desc()).limit(limit).offset(offset)

    result = await db.execute(q)
    orders = list(result.scalars().all())
    total = (await db.execute(count_q)).scalar() or 0
    return orders, total


async def get_order(db: AsyncSession, order_id: uuid.UUID) -> TrafficBotOrder | None:
    result = await db.execute(
        select(TrafficBotOrder).where(TrafficBotOrder.id == order_id)
    )
    return result.scalar_one_or_none()


async def cancel_order(db: AsyncSession, order: TrafficBotOrder) -> TrafficBotOrder:
    if not order.external_order_id:
        raise ValueError("Order has no external ID")
    await traffic_bot_api.cancel_order(order.external_order_id)
    order.status = "cancelled"
    await _refund(db, order.tenant_id, Decimal(str(order.total_cost)), order.id)
    await db.flush()
    return order


async def refill_order(db: AsyncSession, order: TrafficBotOrder) -> dict:
    if not order.external_order_id:
        raise ValueError("Order has no external ID")
    return await traffic_bot_api.refill_order(order.external_order_id)


async def list_all_orders(
    db: AsyncSession, status: str | None = None,
    limit: int = 50, offset: int = 0,
) -> tuple[list[TrafficBotOrder], int]:
    """Admin: list orders across all tenants."""
    q = select(TrafficBotOrder).options(selectinload(TrafficBotOrder.service))
    count_q = select(func.count()).select_from(TrafficBotOrder)
    if status:
        q = q.where(TrafficBotOrder.status == status)
        count_q = count_q.where(TrafficBotOrder.status == status)
    q = q.order_by(TrafficBotOrder.created_at.desc()).limit(limit).offset(offset)

    result = await db.execute(q)
    orders = list(result.scalars().all())
    total = (await db.execute(count_q)).scalar() or 0
    return orders, total
