"""Tenant-level dashboard API — aggregate stats for the current tenant."""
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.job import ScrapingJob, ScrapedProfile
from app.models.credit import CreditBalance, CreditTransaction

router = APIRouter()


@router.get("/stats")
async def tenant_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get aggregate stats for the current user's tenant."""
    tid = user.tenant_id

    total_jobs = (await db.execute(
        select(func.count(ScrapingJob.id)).where(ScrapingJob.tenant_id == tid)
    )).scalar() or 0

    completed_jobs = (await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == tid, ScrapingJob.status == "completed"
        )
    )).scalar() or 0

    failed_jobs = (await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == tid, ScrapingJob.status == "failed"
        )
    )).scalar() or 0

    active_jobs = (await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == tid, ScrapingJob.status.in_(["queued", "running"])
        )
    )).scalar() or 0

    total_profiles = (await db.execute(
        select(func.count(ScrapedProfile.id)).where(ScrapedProfile.tenant_id == tid)
    )).scalar() or 0

    success_profiles = (await db.execute(
        select(func.count(ScrapedProfile.id)).where(
            ScrapedProfile.tenant_id == tid, ScrapedProfile.scrape_status == "success"
        )
    )).scalar() or 0

    # Credit balance
    bal_result = await db.execute(
        select(CreditBalance).where(CreditBalance.tenant_id == tid)
    )
    bal = bal_result.scalar_one_or_none()

    # Credits used this month
    month_start = datetime.combine(date.today().replace(day=1), datetime.min.time(), tzinfo=timezone.utc)
    credits_this_month = (await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount), 0)).where(
            CreditTransaction.tenant_id == tid,
            CreditTransaction.type == "usage",
            CreditTransaction.created_at >= month_start,
        )
    )).scalar() or 0

    # Jobs this week
    today = date.today()
    week_start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    # Go back to Monday
    from datetime import timedelta
    week_start -= timedelta(days=today.weekday())
    jobs_this_week = (await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == tid,
            ScrapingJob.created_at >= week_start,
        )
    )).scalar() or 0

    # Recent jobs (last 10)
    recent_result = await db.execute(
        select(ScrapingJob)
        .where(ScrapingJob.tenant_id == tid)
        .order_by(ScrapingJob.created_at.desc())
        .limit(10)
    )
    recent_jobs = recent_result.scalars().all()

    return {
        "total_jobs": total_jobs,
        "completed_jobs": completed_jobs,
        "failed_jobs": failed_jobs,
        "active_jobs": active_jobs,
        "total_profiles_scraped": total_profiles,
        "success_profiles": success_profiles,
        "credit_balance": bal.balance if bal else 0,
        "lifetime_purchased": bal.lifetime_purchased if bal else 0,
        "lifetime_used": bal.lifetime_used if bal else 0,
        "credits_used_this_month": abs(credits_this_month),
        "jobs_this_week": jobs_this_week,
        "recent_jobs": [
            {
                "id": str(j.id),
                "input_value": j.input_value,
                "status": j.status,
                "result_row_count": j.result_row_count,
                "credits_used": j.credits_used,
                "created_at": j.created_at.isoformat(),
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
            }
            for j in recent_jobs
        ],
    }
