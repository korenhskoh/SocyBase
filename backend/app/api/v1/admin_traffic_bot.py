"""Traffic Bot admin API routes."""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from uuid import UUID

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.user import User
from app.models.traffic_bot import TrafficBotService
from app.services import traffic_bot_service as svc
from app.services import traffic_bot_api
from app.schemas.traffic_bot import (
    ServiceResponse, ServiceUpdateRequest, BulkFeeUpdateRequest,
    WalletDepositRequest, TransactionResponse, OrderResponse, OrderListResponse,
    APIBalanceResponse,
)

router = APIRouter()


# ── Services ────────────────────────────────────────────────

@router.post("/services/sync")
async def sync_services(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        count = await svc.sync_services(db)
    except Exception as exc:
        raise HTTPException(500, f"Sync failed: {exc}")
    return {"synced": count}


@router.get("/services", response_model=list[ServiceResponse])
async def list_all_services(
    category: str | None = None,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_services(db, enabled_only=False, category=category)


@router.patch("/services/{service_id}", response_model=ServiceResponse)
async def update_service(
    service_id: UUID,
    body: ServiceUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = await svc.get_service(db, service_id)
    if not service:
        raise HTTPException(404, "Service not found")
    if body.fee_pct is not None:
        service.fee_pct = body.fee_pct
    if body.is_enabled is not None:
        service.is_enabled = body.is_enabled
    if body.sort_order is not None:
        service.sort_order = body.sort_order
    await db.flush()
    return service


@router.patch("/services/bulk-fee")
async def bulk_update_fee(
    body: BulkFeeUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        update(TrafficBotService)
        .where(TrafficBotService.category == body.category)
        .values(fee_pct=body.fee_pct)
    )
    await db.flush()
    return {"updated": result.rowcount}


# ── Orders ──────────────────────────────────────────────────

@router.get("/orders", response_model=OrderListResponse)
async def list_all_orders(
    status: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    orders, total = await svc.list_all_orders(db, status, limit, offset)
    items = []
    for o in orders:
        resp = OrderResponse.model_validate(o)
        if o.service:
            resp.service_name = o.service.name
        items.append(resp)
    return OrderListResponse(items=items, total=total, limit=limit, offset=offset)


# ── Wallet Admin ────────────────────────────────────────────

@router.post("/wallet/deposit", response_model=TransactionResponse)
async def deposit_to_wallet(
    body: WalletDepositRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    txn = await svc.deposit(db, body.tenant_id, body.amount, body.description)
    return txn


# ── API Balance ─────────────────────────────────────────────

@router.get("/api-balance", response_model=APIBalanceResponse)
async def get_api_balance(
    admin: User = Depends(get_current_admin),
):
    try:
        data = await traffic_bot_api.get_balance()
    except Exception as exc:
        raise HTTPException(500, f"Failed to check balance: {exc}")
    return APIBalanceResponse(
        balance=str(data.get("balance", "0")),
        currency=str(data.get("currency", "USD")),
    )
