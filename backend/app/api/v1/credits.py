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
            "bank_qr_url": "",
        }

    data = setting.value or {}
    return {
        "stripe_enabled": data.get("stripe_enabled", True),
        "bank_transfer_enabled": data.get("bank_transfer_enabled", True),
        "bank_name": data.get("bank_name", ""),
        "bank_account_name": data.get("bank_account_name", ""),
        "bank_account_number": data.get("bank_account_number", ""),
        "bank_duitnow_id": data.get("bank_duitnow_id", ""),
        "bank_qr_url": data.get("bank_qr_url", ""),
        "payment_model": data.get("payment_model", "one_time"),
    }


@router.get("/costs")
async def get_credit_costs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns configurable credit costs from platform settings."""
    from app.models.platform import Platform

    result = await db.execute(select(Platform).limit(1))
    platform = result.scalar_one_or_none()
    return {
        "credit_cost_per_profile": platform.credit_cost_per_profile if platform else 1,
        "credit_cost_per_page": platform.credit_cost_per_page if platform else 1,
        "credit_cost_per_action": getattr(platform, "credit_cost_per_action", 3) if platform else 3,
    }


@router.get("/public-config")
async def get_public_config(db: AsyncSession = Depends(get_db)):
    """Public endpoint: returns payment model setting for landing page."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "payment_settings")
    )
    setting = result.scalar_one_or_none()
    data = setting.value if setting else {}
    return {"payment_model": data.get("payment_model", "one_time")}


@router.get("/whatsapp-contact")
async def get_whatsapp_contact(db: AsyncSession = Depends(get_db)):
    """Public endpoint: returns WhatsApp contact number for tenant floating button."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "whatsapp_settings")
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {"whatsapp_contact_number": None}
    data = setting.value if setting else {}
    number = data.get("whatsapp_contact_number") or data.get("whatsapp_admin_number") or None
    return {"whatsapp_contact_number": number}


@router.get("/tutorial-videos")
async def get_tutorial_videos(db: AsyncSession = Depends(get_db)):
    """Public endpoint: returns tutorial video URLs for scrape type cards."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "tutorial_videos")
    )
    setting = result.scalar_one_or_none()
    data = setting.value if setting else {}
    return {
        "comment_scraper_url": data.get("comment_scraper_url", ""),
        "post_discovery_url": data.get("post_discovery_url", ""),
    }


@router.get("/messenger-templates")
async def get_messenger_templates(db: AsyncSession = Depends(get_db)):
    """Public endpoint: returns messenger templates for profile outreach."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "messenger_templates")
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {"templates": []}
    return {"templates": setting.value.get("templates", [])}


@router.get("/promo-banners")
async def get_promo_banners(db: AsyncSession = Depends(get_db)):
    """Public endpoint: returns active promo banners for dashboard display."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "promo_banners")
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {"banners": []}
    all_banners = setting.value.get("banners", [])
    active = [b for b in all_banners if b.get("is_active", True)]
    return {"banners": active}
