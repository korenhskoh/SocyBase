"""Traffic Bot user-facing API routes."""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from sqlalchemy import select

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.traffic_bot import TrafficBotWalletDeposit
from app.services import traffic_bot_service as svc
from app.services.whatsapp_notify import notify_traffic_bot_order, notify_wallet_deposit_request
from app.services.telegram_notify import send_tb_order_notification
from app.schemas.traffic_bot import (
    OrderCreateRequest, OrderResponse, OrderListResponse,
    ServiceResponse, PriceCalcResponse,
    WalletResponse, TransactionResponse,
    WalletDepositSubmitRequest, WalletDepositResponse,
)

router = APIRouter()


# ── Services ────────────────────────────────────────────────

@router.get("/services", response_model=list[ServiceResponse])
async def list_services(
    category: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    services = await svc.list_services(db, enabled_only=True, category=category)
    return services


@router.get("/services/categories")
async def list_categories(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_categories(db)


@router.get("/services/{service_id}/price", response_model=PriceCalcResponse)
async def calculate_price(
    service_id: UUID,
    quantity: int = Query(gt=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = await svc.get_service(db, service_id)
    if not service:
        raise HTTPException(404, "Service not found")
    return svc.calculate_price(float(service.rate), quantity, float(service.fee_pct))


# ── Orders ──────────────────────────────────────────────────

@router.post("/orders", response_model=OrderResponse)
async def create_order(
    body: OrderCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        order = await svc.place_order(
            db, user.tenant_id, user.id,
            body.service_id, body.link, body.quantity,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    # Service already loaded by place_order -> get_service
    await db.refresh(order, attribute_names=["service"])
    resp = OrderResponse.model_validate(order)
    resp.service_name = order.service.name if order.service else None
    await notify_traffic_bot_order(
        user.email, resp.service_name or "Unknown",
        body.quantity, float(order.total_cost), body.link, db,
    )
    # Telegram notification to the user if linked
    if user.telegram_chat_id:
        await send_tb_order_notification(
            user.telegram_chat_id, order, resp.service_name or "Unknown",
        )
    return resp


@router.get("/orders", response_model=OrderListResponse)
async def list_orders(
    status: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    orders, total = await svc.list_orders(db, user.tenant_id, status, limit, offset)
    # Attach service names
    items = []
    for o in orders:
        resp = OrderResponse.model_validate(o)
        if o.service:
            resp.service_name = o.service.name
        items.append(resp)
    return OrderListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order_detail(
    order_id: UUID,
    refresh: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await svc.get_order(db, order_id)
    if not order or order.tenant_id != user.tenant_id:
        raise HTTPException(404, "Order not found")
    if refresh:
        order = await svc.refresh_order_status(db, order)
    resp = OrderResponse.model_validate(order)
    resp.service_name = order.service.name if order.service else None
    return resp


@router.post("/orders/{order_id}/cancel", response_model=OrderResponse)
async def cancel_order(
    order_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await svc.get_order(db, order_id)
    if not order or order.tenant_id != user.tenant_id:
        raise HTTPException(404, "Order not found")
    try:
        order = await svc.cancel_order(db, order)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return OrderResponse.model_validate(order)


@router.post("/orders/{order_id}/refill")
async def refill_order(
    order_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    order = await svc.get_order(db, order_id)
    if not order or order.tenant_id != user.tenant_id:
        raise HTTPException(404, "Order not found")
    try:
        result = await svc.refill_order(db, order)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return result


# ── Wallet ──────────────────────────────────────────────────

@router.get("/wallet", response_model=WalletResponse)
async def get_wallet(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    wallet = await svc.get_or_create_wallet(db, user.tenant_id)
    return wallet


@router.get("/wallet/transactions", response_model=list[TransactionResponse])
async def get_wallet_transactions(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await svc.get_transactions(db, user.tenant_id, limit, offset)


@router.post("/wallet/deposit-request", response_model=WalletDepositResponse)
async def submit_deposit_request(
    body: WalletDepositSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deposit = TrafficBotWalletDeposit(
        tenant_id=user.tenant_id,
        user_id=user.id,
        amount=body.amount,
        bank_reference=body.bank_reference,
        proof_url=body.proof_url,
        status="pending",
    )
    db.add(deposit)
    await db.flush()
    await notify_wallet_deposit_request(
        user.email, float(body.amount), body.bank_reference, db,
    )
    return deposit


@router.get("/wallet/deposits", response_model=list[WalletDepositResponse])
async def list_my_deposits(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TrafficBotWalletDeposit)
        .where(TrafficBotWalletDeposit.tenant_id == user.tenant_id)
        .order_by(TrafficBotWalletDeposit.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()
