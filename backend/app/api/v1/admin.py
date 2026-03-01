from uuid import UUID
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, or_
from app.database import get_db
from app.dependencies import get_super_admin
from app.models.user import User
from app.models.tenant import Tenant
from app.models.job import ScrapingJob
from app.models.payment import Payment
from app.models.credit import CreditBalance, CreditPackage, CreditTransaction
from app.models.audit import AuditLog
from app.models.system import SystemSetting
from app.services.whatsapp_notify import notify_payment_approved, notify_refund_processed
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
    await notify_payment_approved(
        str(payment.id), payment.amount_cents, payment.currency,
        credits_to_add, payment.method, db,
    )
    return payment


@router.post("/payments/{payment_id}/refund", response_model=PaymentResponse)
async def refund_payment(
    payment_id: UUID,
    data: ApprovePaymentRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Refund a completed payment. For Stripe: auto-refund via API. For bank transfer: marks as refunded (admin handles manually)."""
    import asyncio
    import stripe as stripe_lib
    from app.api.v1.payments import _get_stripe_keys

    result = await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.status == "completed")
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Completed payment not found")

    # Stripe refund via API
    if payment.method == "stripe" and payment.stripe_payment_intent_id:
        stripe_keys = await _get_stripe_keys(db)
        stripe_lib.api_key = stripe_keys["secret_key"]
        try:
            await asyncio.to_thread(stripe_lib.Refund.create, payment_intent=payment.stripe_payment_intent_id)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Stripe refund failed: {str(e)}")

    # Mark payment as refunded
    payment.status = "refunded"
    payment.refunded_at = datetime.now(timezone.utc)
    if data.admin_notes:
        payment.admin_notes = data.admin_notes

    # Deduct credits from tenant
    if payment.credit_package_id:
        pkg_result = await db.execute(
            select(CreditPackage).where(CreditPackage.id == payment.credit_package_id)
        )
        package = pkg_result.scalar_one_or_none()
        credits_to_deduct = (package.credits + package.bonus_credits) if package else 0
    else:
        credits_to_deduct = 0

    if credits_to_deduct > 0:
        balance_result = await db.execute(
            select(CreditBalance)
            .where(CreditBalance.tenant_id == payment.tenant_id)
            .with_for_update()
        )
        balance = balance_result.scalar_one_or_none()
        if balance:
            balance.balance = max(0, balance.balance - credits_to_deduct)
            balance.lifetime_purchased = max(0, balance.lifetime_purchased - credits_to_deduct)

            transaction = CreditTransaction(
                tenant_id=payment.tenant_id,
                user_id=admin.id,
                type="refund",
                amount=-credits_to_deduct,
                balance_after=balance.balance,
                description=f"Refund for payment {str(payment.id)[:8]}",
                reference_type="payment",
                reference_id=payment.id,
            )
            db.add(transaction)

    await db.flush()
    await notify_refund_processed(
        str(payment.id), payment.amount_cents, payment.currency,
        credits_to_deduct, payment.method, db,
    )
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


@router.get("/credits/balances")
async def list_credit_balances(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List all tenants with their credit balance info."""
    result = await db.execute(
        select(
            Tenant.id,
            Tenant.name,
            CreditBalance.balance,
            CreditBalance.lifetime_purchased,
            CreditBalance.lifetime_used,
        )
        .outerjoin(CreditBalance, CreditBalance.tenant_id == Tenant.id)
        .order_by(Tenant.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = result.all()
    return [
        {
            "tenant_id": str(r[0]),
            "tenant_name": r[1],
            "balance": r[2] or 0,
            "lifetime_purchased": r[3] or 0,
            "lifetime_used": r[4] or 0,
        }
        for r in rows
    ]


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
        billing_interval=data.billing_interval,
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
    await db.delete(package)
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


@router.put("/tenants/{tenant_id}/status")
async def update_tenant_status(
    tenant_id: UUID,
    data: UpdateTenantRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Activate or deactivate a tenant account. Deactivating also deactivates all users."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if data.is_active is not None:
        tenant.is_active = data.is_active
        # Bulk update all users under this tenant in a single statement
        await db.execute(
            update(User)
            .where(User.tenant_id == tenant_id)
            .values(is_active=data.is_active)
        )

    await db.flush()
    return {"tenant_id": str(tenant_id), "is_active": tenant.is_active}


# ---------------------------------------------------------------------------
# Tenant Settings (unified)
# ---------------------------------------------------------------------------


class UpdateTenantSettingsRequest(BaseModel):
    max_concurrent_jobs: int | None = Field(None, ge=1, le=50)
    daily_job_limit: int | None = Field(None, ge=0)       # 0 = unlimited
    monthly_credit_limit: int | None = Field(None, ge=0)   # 0 = unlimited


@router.get("/tenants/{tenant_id}/settings")
async def get_tenant_settings(
    tenant_id: UUID,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get full tenant info + settings + usage stats for admin detail page."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    bal_result = await db.execute(
        select(CreditBalance).where(CreditBalance.tenant_id == tenant_id)
    )
    balance = bal_result.scalar_one_or_none()

    today_start = datetime.combine(date.today(), datetime.min.time(), tzinfo=timezone.utc)
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    jobs_today = (await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == tenant_id,
            ScrapingJob.created_at >= today_start,
        )
    )).scalar() or 0

    credits_this_month = (await db.execute(
        select(func.coalesce(func.sum(ScrapingJob.credits_used), 0)).where(
            ScrapingJob.tenant_id == tenant_id,
            ScrapingJob.created_at >= month_start,
        )
    )).scalar() or 0

    active_jobs = (await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == tenant_id,
            ScrapingJob.status.in_(["running", "queued"]),
        )
    )).scalar() or 0

    settings = tenant.settings or {}
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "plan": tenant.plan,
        "is_active": tenant.is_active,
        "created_at": tenant.created_at.isoformat(),
        "settings": {
            "max_concurrent_jobs": settings.get("max_concurrent_jobs", 3),
            "daily_job_limit": settings.get("daily_job_limit", 0),
            "monthly_credit_limit": settings.get("monthly_credit_limit", 0),
        },
        "credit_balance": balance.balance if balance else 0,
        "lifetime_purchased": balance.lifetime_purchased if balance else 0,
        "lifetime_used": balance.lifetime_used if balance else 0,
        "jobs_today": jobs_today,
        "credits_this_month": credits_this_month,
        "active_jobs": active_jobs,
    }


@router.put("/tenants/{tenant_id}/settings")
async def update_tenant_settings(
    tenant_id: UUID,
    data: UpdateTenantSettingsRequest,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update all tenant scraping settings at once."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    settings = dict(tenant.settings or {})
    for field, value in data.model_dump(exclude_unset=True).items():
        settings[field] = value
    tenant.settings = settings
    await db.flush()
    return {"settings": settings}


# ---------------------------------------------------------------------------
# Admin Job Management (cross-tenant)
# ---------------------------------------------------------------------------


@router.get("/jobs")
async def list_all_jobs(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    tenant_id: UUID | None = Query(None),
    search: str | None = Query(None),
):
    """List all jobs across all tenants with filtering."""
    query = (
        select(ScrapingJob, User.email)
        .join(User, ScrapingJob.user_id == User.id)
        .order_by(ScrapingJob.created_at.desc())
    )
    count_query = select(func.count(ScrapingJob.id))

    if status_filter:
        query = query.where(ScrapingJob.status == status_filter)
        count_query = count_query.where(ScrapingJob.status == status_filter)
    if tenant_id:
        query = query.where(ScrapingJob.tenant_id == tenant_id)
        count_query = count_query.where(ScrapingJob.tenant_id == tenant_id)
    if search:
        search_filter = or_(
            User.email.ilike(f"%{search}%"),
            ScrapingJob.input_value.ilike(f"%{search}%"),
        )
        query = query.where(search_filter)
        count_query = (
            count_query.join(User, ScrapingJob.user_id == User.id)
            .where(search_filter)
        )

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(
        query.offset((page - 1) * page_size).limit(page_size)
    )
    rows = result.all()

    jobs = [
        {
            "id": str(row[0].id),
            "tenant_id": str(row[0].tenant_id),
            "user_email": row[1],
            "input_value": row[0].input_value,
            "job_type": row[0].job_type,
            "status": row[0].status,
            "progress_pct": float(row[0].progress_pct),
            "result_row_count": row[0].result_row_count,
            "credits_used": row[0].credits_used,
            "created_at": row[0].created_at.isoformat(),
            "started_at": row[0].started_at.isoformat() if row[0].started_at else None,
            "completed_at": row[0].completed_at.isoformat() if row[0].completed_at else None,
        }
        for row in rows
    ]

    return {"items": jobs, "total": total, "page": page, "page_size": page_size}


@router.post("/jobs/{job_id}/cancel")
async def admin_cancel_job(
    job_id: UUID,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Force cancel any job (cross-tenant)."""
    from app.api.v1.jobs import _revoke_celery_task

    result = await db.execute(select(ScrapingJob).where(ScrapingJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("completed", "cancelled", "failed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job in '{job.status}' status")

    job.status = "cancelled"
    _revoke_celery_task(job.celery_task_id)
    await db.flush()
    return {"detail": "Job cancelled", "job_id": str(job.id)}


@router.post("/jobs/{job_id}/pause")
async def admin_pause_job(
    job_id: UUID,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Force pause any job (cross-tenant)."""
    from app.api.v1.jobs import _revoke_celery_task

    result = await db.execute(select(ScrapingJob).where(ScrapingJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("running", "queued"):
        raise HTTPException(status_code=400, detail=f"Cannot pause job in '{job.status}' status")

    job.status = "paused"
    _revoke_celery_task(job.celery_task_id)
    await db.flush()
    return {"detail": "Job paused", "job_id": str(job.id)}


# ---------------------------------------------------------------------------
# Admin Scraping Overview
# ---------------------------------------------------------------------------


@router.get("/scraping/overview")
async def scraping_overview(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """Global scraping overview — stats per user for super admin."""
    from app.models.job import ScrapedProfile

    # Per-user scraping stats
    user_stats_result = await db.execute(
        select(
            User.id,
            User.email,
            User.full_name,
            User.tenant_id,
            func.count(ScrapingJob.id).label("total_jobs"),
            func.coalesce(func.sum(ScrapingJob.result_row_count), 0).label("total_profiles"),
            func.coalesce(func.sum(ScrapingJob.credits_used), 0).label("total_credits_used"),
        )
        .outerjoin(ScrapingJob, ScrapingJob.user_id == User.id)
        .group_by(User.id, User.email, User.full_name, User.tenant_id)
        .order_by(func.count(ScrapingJob.id).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    user_stats = [
        {
            "user_id": str(row[0]),
            "email": row[1],
            "full_name": row[2],
            "tenant_id": str(row[3]),
            "total_jobs": row[4],
            "total_profiles": row[5],
            "total_credits_used": row[6],
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


# ── Payment Gateway Settings ─────────────────────────────────────────


class PaymentSettingsUpdate(BaseModel):
    stripe_publishable_key: str | None = None
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    bank_name: str | None = None
    bank_account_name: str | None = None
    bank_account_number: str | None = None
    bank_duitnow_id: str | None = None
    bank_swift_code: str | None = None
    stripe_enabled: bool = True
    bank_transfer_enabled: bool = True
    payment_model: str = "one_time"  # one_time, subscription, both


PAYMENT_SETTINGS_KEY = "payment_settings"
PAYMENT_MASKED = "sk_****"


@router.get("/payment-settings")
async def get_payment_settings(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get payment gateway settings (masked secrets)."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == PAYMENT_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {}

    data = dict(setting.value)
    # Mask secret keys
    if data.get("stripe_secret_key"):
        data["stripe_secret_key"] = PAYMENT_MASKED
    if data.get("stripe_webhook_secret"):
        data["stripe_webhook_secret"] = PAYMENT_MASKED
    return data


@router.put("/payment-settings")
async def update_payment_settings(
    data: PaymentSettingsUpdate,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update payment gateway settings."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == PAYMENT_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    existing = dict(setting.value) if setting else {}

    new_value = data.model_dump(exclude_none=True)

    # Preserve existing secrets if masked placeholder sent back
    if new_value.get("stripe_secret_key") == PAYMENT_MASKED:
        new_value["stripe_secret_key"] = existing.get("stripe_secret_key", "")
    if new_value.get("stripe_webhook_secret") == PAYMENT_MASKED:
        new_value["stripe_webhook_secret"] = existing.get("stripe_webhook_secret", "")

    merged = {**existing, **new_value}

    if setting:
        setting.value = merged
        setting.updated_by = admin.id
    else:
        setting = SystemSetting(
            key=PAYMENT_SETTINGS_KEY,
            value=merged,
            description="Payment gateway configuration (Stripe + bank transfer)",
            updated_by=admin.id,
        )
        db.add(setting)

    await db.commit()

    # Return masked version
    resp = dict(merged)
    if resp.get("stripe_secret_key"):
        resp["stripe_secret_key"] = PAYMENT_MASKED
    if resp.get("stripe_webhook_secret"):
        resp["stripe_webhook_secret"] = PAYMENT_MASKED
    return resp


# ── WhatsApp Notification Settings ───────────────────────────────────


WHATSAPP_SETTINGS_KEY = "whatsapp_settings"


class WhatsAppSettingsUpdate(BaseModel):
    whatsapp_service_url: str | None = None
    whatsapp_admin_number: str | None = None
    whatsapp_contact_number: str | None = None  # Tenant-facing "Contact Us" number
    whatsapp_enabled: bool = True
    # Per-notification toggles
    notify_new_user: bool | None = None
    notify_payment_approved: bool | None = None
    notify_payment_completed: bool | None = None
    notify_refund: bool | None = None
    notify_traffic_bot_order: bool | None = None
    notify_wallet_deposit: bool | None = None


@router.get("/whatsapp-settings")
async def get_whatsapp_settings(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get WhatsApp notification settings."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {}
    return dict(setting.value)


@router.put("/whatsapp-settings")
async def update_whatsapp_settings(
    data: WhatsAppSettingsUpdate,
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update WhatsApp notification settings."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    existing = dict(setting.value) if setting else {}

    new_value = data.model_dump(exclude_none=True)
    merged = {**existing, **new_value}

    if setting:
        setting.value = merged
        setting.updated_by = admin.id
    else:
        setting = SystemSetting(
            key=WHATSAPP_SETTINGS_KEY,
            value=merged,
            description="WhatsApp notification configuration (Baileys)",
            updated_by=admin.id,
        )
        db.add(setting)

    await db.commit()
    return merged


@router.get("/whatsapp-status")
async def proxy_whatsapp_status(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Proxy WhatsApp service /status through the backend so the browser doesn't need direct access."""
    import httpx

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    service_url = (setting.value.get("whatsapp_service_url") if setting else None) or "http://localhost:3001"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{service_url.rstrip('/')}/status")
            return resp.json()
    except Exception:
        return {"status": "unreachable"}


@router.get("/whatsapp-qr")
async def proxy_whatsapp_qr(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Proxy WhatsApp service /qr through the backend for QR code pairing."""
    import httpx

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    service_url = (setting.value.get("whatsapp_service_url") if setting else None) or "http://localhost:3001"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{service_url.rstrip('/')}/qr")
            return resp.json()
    except Exception:
        return {"status": "error", "message": "Cannot reach WhatsApp service. Make sure it is running and the Service URL is correct."}


@router.post("/whatsapp-disconnect")
async def proxy_whatsapp_disconnect(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Proxy WhatsApp service /disconnect to log out and allow re-pairing."""
    import httpx

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    service_url = (setting.value.get("whatsapp_service_url") if setting else None) or "http://localhost:3001"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{service_url.rstrip('/')}/disconnect")
            return resp.json()
    except Exception:
        return {"success": False, "message": "Cannot reach WhatsApp service."}


@router.post("/whatsapp-test")
async def send_whatsapp_test(
    admin: User = Depends(get_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Send a test notification to confirm WhatsApp is working."""
    import httpx
    from datetime import datetime, timezone

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == WHATSAPP_SETTINGS_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=400, detail="WhatsApp settings not configured yet.")

    config = dict(setting.value)
    service_url = config.get("whatsapp_service_url") or "http://localhost:3001"
    admin_number = config.get("whatsapp_admin_number")

    if not admin_number:
        raise HTTPException(status_code=400, detail="Admin phone number not set. Save settings first.")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    message = (
        f"*SocyBase Test Notification*\n\n"
        f"This is a test message to confirm WhatsApp notifications are working.\n"
        f"Time: {now}\n"
        f"Sent by: {admin.email}"
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{service_url.rstrip('/')}/send",
                json={"to": admin_number, "message": message},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return {"success": True, "message": "Test notification sent successfully!"}
            else:
                return {"success": False, "message": data.get("error", "Failed to send test message.")}
    except Exception as e:
        return {"success": False, "message": f"Cannot reach WhatsApp service: {str(e)}"}
