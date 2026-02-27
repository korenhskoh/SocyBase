from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.credit import CreditBalance, CreditTransaction, CreditPackage
from app.models.system import SystemSetting
from app.schemas.credit import (
    CreditBalanceResponse,
    CreditTransactionResponse,
    CreditPackageResponse,
)

router = APIRouter()


@router.get("/balance", response_model=CreditBalanceResponse)
async def get_balance(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
    )
    balance = result.scalar_one_or_none()
    if not balance:
        return CreditBalanceResponse(balance=0, lifetime_purchased=0, lifetime_used=0)
    return balance


@router.get("/history", response_model=list[CreditTransactionResponse])
async def get_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.tenant_id == user.tenant_id)
        .order_by(CreditTransaction.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


@router.get("/packages", response_model=list[CreditPackageResponse])
async def get_packages(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CreditPackage)
        .where(CreditPackage.is_active == True)
        .order_by(CreditPackage.sort_order)
    )
    return result.scalars().all()


@router.get("/payment-info")
async def get_payment_info(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get public payment info (bank details, enabled methods) for the credits page."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "payment_settings")
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {
            "stripe_enabled": True,
            "bank_transfer_enabled": True,
            "bank_name": "",
            "bank_account_name": "",
            "bank_account_number": "",
            "bank_duitnow_id": "",
        }

    data = setting.value or {}
    return {
        "stripe_enabled": data.get("stripe_enabled", True),
        "bank_transfer_enabled": data.get("bank_transfer_enabled", True),
        "bank_name": data.get("bank_name", ""),
        "bank_account_name": data.get("bank_account_name", ""),
        "bank_account_number": data.get("bank_account_number", ""),
        "bank_duitnow_id": data.get("bank_duitnow_id", ""),
    }
