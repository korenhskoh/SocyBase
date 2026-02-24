from uuid import UUID
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.tenant import Tenant
from app.models.job import ScrapingJob, ScrapedProfile, ExtractedComment, ScrapedPost
from app.models.platform import Platform
from app.schemas.job import (
    CreateJobRequest,
    ResumeJobRequest,
    JobResponse,
    JobProgressResponse,
    EstimateRequest,
    EstimateResponse,
    ScrapedProfileResponse,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────


def _revoke_celery_task(celery_task_id: str | None):
    """Revoke a Celery task by ID if set."""
    if celery_task_id:
        from app.celery_app import celery_app
        celery_app.control.revoke(celery_task_id, terminate=True, signal="SIGTERM")


async def _get_tenant_job(db: AsyncSession, job_id: UUID, tenant_id) -> ScrapingJob:
    """Load a job belonging to a tenant, or raise 404."""
    result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── Create ───────────────────────────────────────────────────────────


@router.post("", response_model=JobResponse, status_code=201)
async def create_job(
    data: CreateJobRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Find platform
    result = await db.execute(
        select(Platform).where(Platform.name == data.platform, Platform.is_enabled == True)
    )
    platform = result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=400, detail=f"Platform '{data.platform}' not found or disabled")

    # Concurrent job limit check
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    max_concurrent = (tenant.settings or {}).get("max_concurrent_jobs", 3) if tenant else 3

    running_count_result = await db.execute(
        select(func.count(ScrapingJob.id)).where(
            ScrapingJob.tenant_id == user.tenant_id,
            ScrapingJob.status.in_(["running", "queued"]),
        )
    )
    running_count = running_count_result.scalar() or 0

    if running_count >= max_concurrent and not data.scheduled_at:
        raise HTTPException(
            status_code=429,
            detail=f"Concurrent job limit reached ({running_count}/{max_concurrent}). "
                   f"Wait for current jobs to finish or schedule for later.",
        )

    # Create job
    job = ScrapingJob(
        tenant_id=user.tenant_id,
        user_id=user.id,
        platform_id=platform.id,
        job_type=data.job_type,
        input_type=data.input_type,
        input_value=data.input_value,
        scheduled_at=data.scheduled_at,
        settings=data.settings,
        status="scheduled" if data.scheduled_at else "queued",
    )
    db.add(job)
    await db.flush()

    # Dispatch Celery task if not scheduled
    if not data.scheduled_at:
        if data.job_type == "post_discovery":
            from app.scraping.tasks import run_post_discovery_pipeline
            task = run_post_discovery_pipeline.delay(str(job.id))
        else:
            from app.scraping.tasks import run_scraping_pipeline
            task = run_scraping_pipeline.delay(str(job.id))
        job.celery_task_id = task.id
        await db.flush()

    return job


# ── List / Get ───────────────────────────────────────────────────────


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
):
    query = (
        select(ScrapingJob)
        .where(ScrapingJob.tenant_id == user.tenant_id)
        .order_by(ScrapingJob.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if status_filter:
        query = query.where(ScrapingJob.status == status_filter)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/cursor-history")
async def get_cursor_history(
    input_value: str = Query(..., min_length=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return cursor history from previous failed/cancelled jobs for the same post URL."""
    result = await db.execute(
        select(ScrapingJob)
        .where(
            ScrapingJob.tenant_id == user.tenant_id,
            ScrapingJob.input_value == input_value,
            ScrapingJob.status.in_(["failed", "cancelled"]),
        )
        .order_by(ScrapingJob.created_at.desc())
        .limit(20)
    )
    jobs = result.scalars().all()

    history = []
    for j in jobs:
        state = (j.error_details or {}).get("pipeline_state", {})
        cursor = state.get("last_cursor")
        if cursor:
            history.append({
                "job_id": str(j.id),
                "status": j.status,
                "created_at": j.created_at.isoformat(),
                "last_cursor": cursor,
                "comment_pages_fetched": state.get("comment_pages_fetched", 0),
                "total_comments_fetched": state.get("total_comments_fetched", 0),
            })

    return history


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _get_tenant_job(db, job_id, user.tenant_id)


@router.get("/{job_id}/progress", response_model=JobProgressResponse)
async def get_job_progress(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _get_tenant_job(db, job_id, user.tenant_id)


# ── Actions ──────────────────────────────────────────────────────────


@router.post("/{job_id}/pause", status_code=200)
async def pause_job(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pause a running or queued job. Can be resumed later."""
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    if job.status not in ("running", "queued"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause job in '{job.status}' status. Only running or queued jobs can be paused.",
        )

    job.status = "paused"
    _revoke_celery_task(job.celery_task_id)
    await db.flush()
    return {"detail": "Job paused", "job_id": str(job.id)}


@router.delete("/{job_id}", status_code=204)
async def cancel_job(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stop a running or queued job (sets status to cancelled)."""
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    if job.status in ("completed", "cancelled", "failed", "paused"):
        raise HTTPException(status_code=400, detail=f"Cannot stop job in '{job.status}' status")

    job.status = "cancelled"
    _revoke_celery_task(job.celery_task_id)
    await db.flush()


@router.delete("/{job_id}/delete", status_code=204)
async def hard_delete_job(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a job and all its data. Only for terminal-state jobs."""
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    if job.status not in ("completed", "failed", "cancelled", "paused"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete job in '{job.status}' status. Stop or wait for it to finish first.",
        )

    await db.delete(job)
    await db.flush()


@router.post("/{job_id}/resume", response_model=JobResponse, status_code=201)
async def resume_job(
    job_id: UUID,
    data: ResumeJobRequest = ResumeJobRequest(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resume a failed or paused job by creating a new job from the last checkpoint."""
    original_job = await _get_tenant_job(db, job_id, user.tenant_id)

    if original_job.status not in ("failed", "paused"):
        raise HTTPException(
            status_code=400,
            detail=f"Can only resume failed or paused jobs. This job is '{original_job.status}'.",
        )

    pipeline_state = (original_job.error_details or {}).get("pipeline_state")
    if not pipeline_state:
        raise HTTPException(
            status_code=400,
            detail="This job has no checkpoint data. Please create a new job instead.",
        )

    new_job = ScrapingJob(
        tenant_id=original_job.tenant_id,
        user_id=user.id,
        platform_id=original_job.platform_id,
        job_type=original_job.job_type,
        input_type=original_job.input_type,
        input_value=original_job.input_value,
        input_metadata=original_job.input_metadata,
        settings={
            **(original_job.settings or {}),
            "resume_from_job_id": str(original_job.id),
            "profile_retry_count": data.profile_retry_count,
        },
        status="queued",
    )
    db.add(new_job)
    await db.flush()

    if original_job.job_type == "post_discovery":
        from app.scraping.tasks import run_post_discovery_pipeline
        task = run_post_discovery_pipeline.delay(str(new_job.id))
    else:
        from app.scraping.tasks import run_scraping_pipeline
        task = run_scraping_pipeline.delay(str(new_job.id))
    new_job.celery_task_id = task.id
    await db.flush()

    return new_job


# ── Batch Actions ────────────────────────────────────────────────────


class BatchActionRequest(BaseModel):
    action: str = Field(..., pattern="^(pause|stop|delete)$")
    job_ids: list[str] = Field(..., min_length=1, max_length=50)


@router.post("/batch")
async def batch_action(
    data: BatchActionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply an action to multiple jobs at once."""
    success = []
    failed = []

    for jid_str in data.job_ids:
        try:
            jid = UUID(jid_str)
        except ValueError:
            failed.append({"id": jid_str, "reason": "Invalid job ID"})
            continue

        result = await db.execute(
            select(ScrapingJob).where(
                ScrapingJob.id == jid,
                ScrapingJob.tenant_id == user.tenant_id,
            )
        )
        job = result.scalar_one_or_none()
        if not job:
            failed.append({"id": jid_str, "reason": "Job not found"})
            continue

        if data.action == "pause":
            if job.status not in ("running", "queued"):
                failed.append({"id": jid_str, "reason": f"Cannot pause '{job.status}' job"})
                continue
            job.status = "paused"
            _revoke_celery_task(job.celery_task_id)
            success.append(jid_str)

        elif data.action == "stop":
            if job.status in ("completed", "cancelled", "failed", "paused"):
                failed.append({"id": jid_str, "reason": f"Cannot stop '{job.status}' job"})
                continue
            job.status = "cancelled"
            _revoke_celery_task(job.celery_task_id)
            success.append(jid_str)

        elif data.action == "delete":
            if job.status not in ("completed", "failed", "cancelled", "paused"):
                failed.append({"id": jid_str, "reason": f"Cannot delete '{job.status}' job"})
                continue
            await db.delete(job)
            success.append(jid_str)

    await db.flush()
    return {"success": success, "failed": failed}


# ── Logs ─────────────────────────────────────────────────────────────


@router.get("/{job_id}/logs")
async def get_job_logs(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return structured log entries for a job."""
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    details = job.error_details or {}
    logs = list(details.get("logs", []))

    # If no explicit logs, reconstruct timeline from pipeline_state and error
    if not logs:
        state = details.get("pipeline_state", {})
        error = details.get("error")

        if job.started_at:
            logs.append({"ts": job.started_at.isoformat(), "level": "info", "stage": "start", "msg": "Job started"})

        if state.get("comment_pages_fetched"):
            logs.append({
                "ts": job.updated_at.isoformat() if job.updated_at else job.created_at.isoformat(),
                "level": "info", "stage": "fetch_comments",
                "msg": f"Fetched {state.get('comment_pages_fetched', 0)} pages, {state.get('total_comments_fetched', 0)} comments",
            })

        if state.get("unique_user_ids_found"):
            logs.append({
                "ts": job.updated_at.isoformat() if job.updated_at else job.created_at.isoformat(),
                "level": "info", "stage": "deduplicate",
                "msg": f"Found {state['unique_user_ids_found']} unique users",
            })

        if state.get("profiles_enriched"):
            msg = f"Enriched {state['profiles_enriched']} profiles"
            if state.get("profiles_failed"):
                msg += f" ({state['profiles_failed']} failed)"
            logs.append({
                "ts": job.updated_at.isoformat() if job.updated_at else job.created_at.isoformat(),
                "level": "info", "stage": "enrich_profiles", "msg": msg,
            })

        if error:
            logs.append({
                "ts": error.get("timestamp", ""),
                "level": "error", "stage": error.get("stage", "unknown"),
                "msg": f"[{error.get('exception_type', 'Error')}] {error.get('message', 'Unknown error')}",
            })

        if job.status == "completed" and job.completed_at:
            logs.append({
                "ts": job.completed_at.isoformat(), "level": "info", "stage": "finalize",
                "msg": f"Completed — {job.result_row_count} profiles, {job.credits_used} credits used",
            })

        if job.status == "paused":
            logs.append({
                "ts": job.updated_at.isoformat() if job.updated_at else job.created_at.isoformat(),
                "level": "warn", "stage": state.get("current_stage", "unknown"), "msg": "Job paused by user",
            })

        if job.status == "cancelled":
            logs.append({
                "ts": job.updated_at.isoformat() if job.updated_at else job.created_at.isoformat(),
                "level": "warn", "stage": state.get("current_stage", "unknown"), "msg": "Job stopped by user",
            })

    return {"job_id": str(job.id), "status": job.status, "logs": logs}


# ── Posts (for post_discovery jobs) ──────────────────────────────────


class ScrapedPostResponse(BaseModel):
    id: UUID
    post_id: str
    message: str | None = None
    created_time: datetime | None = None
    updated_time: datetime | None = None
    from_name: str | None = None
    from_id: str | None = None
    comment_count: int = 0
    reaction_count: int = 0
    share_count: int = 0
    attachment_type: str | None = None
    attachment_url: str | None = None
    post_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/{job_id}/posts", response_model=list[ScrapedPostResponse])
async def get_job_posts(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Get discovered posts for a post_discovery job."""
    await _get_tenant_job(db, job_id, user.tenant_id)
    result = await db.execute(
        select(ScrapedPost)
        .where(ScrapedPost.job_id == job_id)
        .order_by(ScrapedPost.created_time.desc().nulls_last())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


class CreateFromPostsRequest(BaseModel):
    post_ids: list[str] = Field(..., min_length=1, max_length=100)
    settings: dict = Field(default_factory=dict)


@router.post("/create-from-posts", status_code=201)
async def create_jobs_from_posts(
    data: CreateFromPostsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create comment scraping jobs for selected discovered posts."""
    # Find facebook platform
    result = await db.execute(
        select(Platform).where(Platform.name == "facebook", Platform.is_enabled == True)
    )
    platform = result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=400, detail="Facebook platform not found or disabled")

    created_jobs = []
    for post_id in data.post_ids:
        job = ScrapingJob(
            tenant_id=user.tenant_id,
            user_id=user.id,
            platform_id=platform.id,
            job_type="full_pipeline",
            input_type="post_url",
            input_value=post_id,
            settings=data.settings,
            status="queued",
        )
        db.add(job)
        await db.flush()

        from app.scraping.tasks import run_scraping_pipeline
        task = run_scraping_pipeline.delay(str(job.id))
        job.celery_task_id = task.id
        await db.flush()

        created_jobs.append({"id": str(job.id), "post_id": post_id, "status": "queued"})

    return {"created": created_jobs, "count": len(created_jobs)}


# ── Results / Estimate / Report ──────────────────────────────────────


@router.get("/{job_id}/results", response_model=list[ScrapedProfileResponse])
async def get_job_results(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    await _get_tenant_job(db, job_id, user.tenant_id)
    result = await db.execute(
        select(ScrapedProfile)
        .where(ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success")
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return result.scalars().all()


@router.post("/estimate", response_model=EstimateResponse)
async def estimate_job(
    data: EstimateRequest,
    user: User = Depends(get_current_user),
):
    return EstimateResponse(
        estimated_comments=100,
        estimated_profiles=80,
        estimated_credits=82,
        message="Estimates are approximate. Actual costs depend on the number of unique commenters.",
    )


@router.get("/{job_id}/report")
async def get_job_report(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a detailed completion report for a finished job."""
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    total_profiles = (await db.execute(
        select(func.count(ScrapedProfile.id)).where(ScrapedProfile.job_id == job_id)
    )).scalar() or 0

    success_profiles = (await db.execute(
        select(func.count(ScrapedProfile.id)).where(
            ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success",
        )
    )).scalar() or 0

    failed_profiles = (await db.execute(
        select(func.count(ScrapedProfile.id)).where(
            ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "failed",
        )
    )).scalar() or 0

    gender_result = await db.execute(
        select(ScrapedProfile.gender, func.count(ScrapedProfile.id))
        .where(ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success")
        .group_by(ScrapedProfile.gender)
    )
    gender_stats = {(row[0] or "Unknown"): row[1] for row in gender_result.all()}

    location_result = await db.execute(
        select(ScrapedProfile.location, func.count(ScrapedProfile.id))
        .where(ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success", ScrapedProfile.location.isnot(None))
        .group_by(ScrapedProfile.location)
        .order_by(func.count(ScrapedProfile.id).desc())
        .limit(10)
    )
    location_stats = {row[0]: row[1] for row in location_result.all()}

    fields = ["name", "gender", "birthday", "education", "work", "location", "hometown", "website"]
    completeness = {}
    for field in fields:
        col = getattr(ScrapedProfile, field if field != "relationship" else "relationship_status")
        filled = (await db.execute(
            select(func.count(ScrapedProfile.id)).where(
                ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success",
                col.isnot(None), col != "",
            )
        )).scalar() or 0
        completeness[field] = filled

    duration_seconds = None
    if job.started_at and job.completed_at:
        duration_seconds = int((job.completed_at - job.started_at).total_seconds())

    pipeline_state = (job.error_details or {}).get("pipeline_state", {})

    return {
        "job_id": str(job.id), "status": job.status,
        "input_value": job.input_value, "input_type": job.input_type,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "duration_seconds": duration_seconds, "credits_used": job.credits_used,
        "total_profiles": total_profiles, "success_profiles": success_profiles,
        "failed_profiles": failed_profiles,
        "success_rate": round(success_profiles / total_profiles * 100, 1) if total_profiles > 0 else 0,
        "gender_stats": gender_stats, "location_stats": location_stats,
        "field_completeness": completeness,
        "total_comments_fetched": pipeline_state.get("total_comments_fetched", 0),
        "comment_pages_fetched": pipeline_state.get("comment_pages_fetched", 0),
        "unique_user_ids_found": pipeline_state.get("unique_user_ids_found", 0),
        "error_message": job.error_message,
    }
