from uuid import UUID
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.dependencies import get_super_admin
from app.models.user import User
from app.models.tenant import Tenant
from app.models.job import ScrapingJob
from app.models.payment import Payment
from app.models.credit import CreditBalance, CreditPackage, CreditTransaction
from app.models.audit import AuditLog
from app.models.system import SystemSetting
from pydantic import BaseModel, Field
from app.schemas.admin import (
    AdminDashboardResponse,
    UpdateUserRequest,
    UpdateTenantRequest,
    GrantCreditsRequest,
    ApprovePaymentRequest,
    AuditLogResponse,
)
from app.schemas.auth import UserResponse


class SetConcurrencyRequest(BaseModel):
    max_concurrent_jobs: int = Field(ge=1, le=50)
from app.schemas.credit import (
    AdminCreditPackageResponse,
    CreateCreditPackageRequest,
    UpdateCreditPackageRequest,
)
from app.schemas.payment import PaymentResponse

router = APIRouter()


@router.get("/dashboard", response_model=AdminDashboardResponse)
async def admin_dashboard(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_tenants = (await db.execute(select(func.count(Tenant.id)))).scalar() or 0
    total_jobs = (await db.execute(select(func.count(ScrapingJob.id)))).scalar() or 0
    active_jobs = (
        await db.execute(
            select(func.count(ScrapingJob.id)).where(ScrapingJob.status.in_(["queued", "running"]))
        )
    ).scalar() or 0

    total_revenue = (
        await db.execute(
            select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(Payment.status == "completed")
        )
    ).scalar() or 0

    total_credits_sold = (
        await db.execute(
            select(func.coalesce(func.sum(CreditBalance.lifetime_purchased), 0))
        )
    ).scalar() or 0

    today_start = datetime.combine(date.today(), datetime.min.time(), tzinfo=timezone.utc)
    jobs_today = (
        await db.execute(
            select(func.count(ScrapingJob.id)).where(ScrapingJob.created_at >= today_start)
        )
    ).scalar() or 0

    return AdminDashboardResponse(
        total_users=total_users,
        total_tenants=total_tenants,
        total_jobs=total_jobs,
        total_credits_sold=total_credits_sold,
        total_revenue_cents=total_revenue,
        active_jobs=active_jobs,
        jobs_today=jobs_today,
    )


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    result = await db.execute(
        select(User)
        .order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    data: UpdateUserRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    await db.flush()
    return user


@router.get("/payments", response_model=list[PaymentResponse])
async def list_payments(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = select(Payment).order_by(Payment.created_at.desc())
    if status_filter:
        query = query.where(Payment.status == status_filter)
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/payments/{payment_id}/approve", response_model=PaymentResponse)
async def approve_payment(
    payment_id: UUID,
    data: ApprovePaymentRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.status == "pending")
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Pending payment not found")

    # Update payment
    payment.status = "completed"
    payment.completed_at = datetime.now(timezone.utc)
    if data.admin_notes:
        payment.admin_notes = data.admin_notes

    # Credit tenant (row-level lock to prevent race conditions)
    balance_result = await db.execute(
        select(CreditBalance)
        .where(CreditBalance.tenant_id == payment.tenant_id)
        .with_for_update()
    )
    balance = balance_result.scalar_one_or_none()

    if payment.credit_package_id:
        from app.models.credit import CreditPackage
        pkg_result = await db.execute(
            select(CreditPackage).where(CreditPackage.id == payment.credit_package_id)
        )
        package = pkg_result.scalar_one()
        credits_to_add = package.credits + package.bonus_credits
    else:
        credits_to_add = 0

    if balance and credits_to_add > 0:
        balance.balance += credits_to_add
        balance.lifetime_purchased += credits_to_add

        transaction = CreditTransaction(
            tenant_id=payment.tenant_id,
            user_id=payment.user_id,
            type="purchase",
            amount=credits_to_add,
            balance_after=balance.balance,
            description=f"Payment approved (bank transfer)",
            reference_type="payment",
            reference_id=payment.id,
        )
        db.add(transaction)

    await db.flush()
    return payment


@router.post("/payments/{payment_id}/reject", response_model=PaymentResponse)
async def reject_payment(
    payment_id: UUID,
    data: ApprovePaymentRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.status == "pending")
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Pending payment not found")

    payment.status = "failed"
    if data.admin_notes:
        payment.admin_notes = data.admin_notes
    await db.flush()
    return payment


@router.post("/credits/grant")
async def grant_credits(
    data: GrantCreditsRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    balance_result = await db.execute(
        select(CreditBalance)
        .where(CreditBalance.tenant_id == data.tenant_id)
        .with_for_update()
    )
    balance = balance_result.scalar_one_or_none()
    if not balance:
        raise HTTPException(status_code=404, detail="Tenant credit balance not found")

    balance.balance += data.amount
    balance.lifetime_purchased += data.amount

    transaction = CreditTransaction(
        tenant_id=data.tenant_id,
        user_id=admin.id,
        type="admin_grant",
        amount=data.amount,
        balance_after=balance.balance,
        description=data.description,
    )
    db.add(transaction)
    await db.flush()

    return {"message": f"Granted {data.amount} credits", "new_balance": balance.balance}


@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Credit Package Management
# ---------------------------------------------------------------------------


@router.get("/packages", response_model=list[AdminCreditPackageResponse])
async def list_packages(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CreditPackage).order_by(CreditPackage.sort_order)
    )
    return result.scalars().all()


@router.post("/packages", response_model=AdminCreditPackageResponse, status_code=201)
async def create_package(
    data: CreateCreditPackageRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    package = CreditPackage(
        name=data.name,
        credits=data.credits,
        price_cents=data.price_cents,
        currency=data.currency,
        stripe_price_id=data.stripe_price_id,
        bonus_credits=data.bonus_credits,
        is_active=data.is_active,
        sort_order=data.sort_order,
    )
    db.add(package)
    await db.flush()
    return package


@router.put("/packages/{package_id}", response_model=AdminCreditPackageResponse)
async def update_package(
    package_id: UUID,
    data: UpdateCreditPackageRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CreditPackage).where(CreditPackage.id == package_id)
    )
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(package, field, value)
    await db.flush()
    return package


@router.delete("/packages/{package_id}", status_code=204)
async def delete_package(
    package_id: UUID,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CreditPackage).where(CreditPackage.id == package_id)
    )
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")
    package.is_active = False
    await db.flush()


# ---------------------------------------------------------------------------
# Tenant Concurrency Limit
# ---------------------------------------------------------------------------


@router.get("/tenants/{tenant_id}/concurrency")
async def get_tenant_concurrency(
    tenant_id: UUID,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"max_concurrent_jobs": (tenant.settings or {}).get("max_concurrent_jobs", 3)}


@router.put("/tenants/{tenant_id}/concurrency")
async def set_tenant_concurrency(
    tenant_id: UUID,
    data: SetConcurrencyRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    settings = dict(tenant.settings or {})
    settings["max_concurrent_jobs"] = data.max_concurrent_jobs
    tenant.settings = settings
    await db.flush()
    return {"max_concurrent_jobs": data.max_concurrent_jobs}


# ---------------------------------------------------------------------------
# Admin Scraping Overview
# ---------------------------------------------------------------------------


@router.get("/scraping/overview")
async def scraping_overview(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Global scraping overview — stats per user for super admin."""
    from app.models.job import ScrapedProfile

    # Per-user scraping stats
    user_stats_result = await db.execute(
        select(
            User.id,
            User.email,
            User.full_name,
            func.count(ScrapingJob.id).label("total_jobs"),
            func.coalesce(func.sum(ScrapingJob.result_row_count), 0).label("total_profiles"),
            func.coalesce(func.sum(ScrapingJob.credits_used), 0).label("total_credits_used"),
        )
        .outerjoin(ScrapingJob, ScrapingJob.user_id == User.id)
        .group_by(User.id, User.email, User.full_name)
        .order_by(func.count(ScrapingJob.id).desc())
    )
    user_stats = [
        {
            "user_id": str(row[0]),
            "email": row[1],
            "full_name": row[2],
            "total_jobs": row[3],
            "total_profiles": row[4],
            "total_credits_used": row[5],
        }
        for row in user_stats_result.all()
    ]

    # Platform breakdown
    from app.models.platform import Platform
    platform_stats_result = await db.execute(
        select(
            Platform.display_name,
            func.count(ScrapingJob.id).label("job_count"),
            func.coalesce(func.sum(ScrapingJob.result_row_count), 0).label("profiles"),
        )
        .join(ScrapingJob, ScrapingJob.platform_id == Platform.id)
        .group_by(Platform.display_name)
    )
    platform_stats = [
        {"platform": row[0], "job_count": row[1], "profiles": row[2]}
        for row in platform_stats_result.all()
    ]

    # Status breakdown
    status_result = await db.execute(
        select(ScrapingJob.status, func.count(ScrapingJob.id))
        .group_by(ScrapingJob.status)
    )
    status_breakdown = {row[0]: row[1] for row in status_result.all()}

    # Recent jobs (last 20 across all users)
    recent_result = await db.execute(
        select(ScrapingJob, User.email)
        .join(User, ScrapingJob.user_id == User.id)
        .order_by(ScrapingJob.created_at.desc())
        .limit(20)
    )
    recent_jobs = [
        {
            "id": str(row[0].id),
            "user_email": row[1],
            "input_value": row[0].input_value,
            "status": row[0].status,
            "result_row_count": row[0].result_row_count,
            "credits_used": row[0].credits_used,
            "progress_pct": float(row[0].progress_pct),
            "created_at": row[0].created_at.isoformat(),
            "completed_at": row[0].completed_at.isoformat() if row[0].completed_at else None,
        }
        for row in recent_result.all()
    ]

    return {
        "user_stats": user_stats,
        "platform_stats": platform_stats,
        "status_breakdown": status_breakdown,
        "recent_jobs": recent_jobs,
    }


# ── System Feature Flags ─────────────────────────────────────────────


class FeatureFlagUpdate(BaseModel):
    key: str
    enabled: bool
    description: str | None = None


# Known feature flags with their defaults
FEATURE_FLAG_DEFAULTS = {
    "dedup_save_credits": {"enabled": True, "description": "Allow users to skip duplicate comment users across jobs to save credits"},
}


@router.get("/feature-flags")
async def get_feature_flags(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get all feature flags with their current state."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key.like("feature_flag_%"))
    )
    stored = {s.key: s.value for s in result.scalars().all()}

    flags = {}
    for key, defaults in FEATURE_FLAG_DEFAULTS.items():
        db_key = f"feature_flag_{key}"
        if db_key in stored:
            flags[key] = stored[db_key]
        else:
            flags[key] = defaults
    return {"flags": flags}


@router.put("/feature-flags")
async def update_feature_flag(
    data: FeatureFlagUpdate,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Enable or disable a feature flag."""
    if data.key not in FEATURE_FLAG_DEFAULTS:
        raise HTTPException(status_code=400, detail=f"Unknown feature flag: {data.key}")

    db_key = f"feature_flag_{data.key}"
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == db_key)
    )
    setting = result.scalar_one_or_none()

    value = {"enabled": data.enabled, "description": data.description or FEATURE_FLAG_DEFAULTS[data.key]["description"]}

    if setting:
        setting.value = value
        setting.updated_by = admin.id
    else:
        setting = SystemSetting(
            key=db_key,
            value=value,
            description=FEATURE_FLAG_DEFAULTS[data.key]["description"],
            updated_by=admin.id,
        )
        db.add(setting)

    await db.commit()
    return {"key": data.key, **value}
