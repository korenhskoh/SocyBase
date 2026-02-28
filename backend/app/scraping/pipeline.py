"""
Scraping Pipeline Orchestrator

Dispatches and manages the 5-stage scraping pipeline:
  1. Parse Input (extract post ID from URL)
  2. Fetch Comments (paginated)
  3. Extract & Deduplicate User IDs
  4. Enrich Profiles (with retries)
  5. Compile Results (generate export file)

Supports resuming from a previous failed job via settings.resume_from_job_id.
Pipeline state is persisted progressively to error_details.pipeline_state.
"""
import asyncio
import logging
import traceback as tb_module
from datetime import datetime, timezone

import httpx

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.job import ScrapingJob, ScrapedProfile, ExtractedComment, PageAuthorProfile
from app.models.credit import CreditBalance, CreditTransaction
from app.models.tenant import Tenant
from app.models.user import User
from app.scraping.clients.facebook import FacebookGraphClient
from app.scraping.mappers.facebook_mapper import FacebookProfileMapper
from app.scraping.rate_limiter import RateLimiter
from app.celery_app import celery_app
from app.services.progress_publisher import publish_job_progress
from app.plan_defaults import resolve_setting

logger = logging.getLogger(__name__)

# ── Helpers ──────────────────────────────────────────────────────────


def _calc_stage_progress(stage: str, **ctx) -> float:
    """Calculate overall progress percentage based on current pipeline stage.

    Stage weights:
      parse_input   →  0-5%
      fetch_author  →  5-8%
      fetch_comments→  8-35%  (scales with pages fetched)
      deduplicate   → 35-40%
      enrich_profiles→ 40-98% (scales with profiles done)
      finalize      → 100%
    """
    if stage == "parse_input":
        return 5.0
    if stage == "fetch_author":
        return 8.0
    if stage == "fetch_comments":
        pages = ctx.get("pages_fetched", 0)
        return min(8.0 + pages * 2.0, 35.0)
    if stage == "deduplicate":
        return 38.0
    if stage == "enrich_profiles":
        done = ctx.get("done", 0)
        total = ctx.get("total", 1)
        if total == 0:
            return 40.0
        return round(40.0 + (done / total) * 58.0, 2)
    if stage == "finalize":
        return 100.0
    return 0.0


def _build_progress_event(job: ScrapingJob, stage: str, stage_data: dict | None = None) -> dict:
    """Build a progress event dict with stage info for Redis publish."""
    return {
        "status": job.status,
        "progress_pct": float(job.progress_pct),
        "processed_items": job.processed_items,
        "total_items": job.total_items,
        "failed_items": job.failed_items,
        "result_row_count": job.result_row_count,
        "current_stage": stage,
        "stage_data": stage_data or {},
    }


async def _save_pipeline_state(db: AsyncSession, job: ScrapingJob, stage: str, **extra):
    """Persist incremental pipeline progress to error_details.pipeline_state."""
    current = dict(job.error_details or {})
    state = dict(current.get("pipeline_state", {}))
    state["current_stage"] = stage
    state.update(extra)
    current["pipeline_state"] = state
    job.error_details = current
    await db.commit()


async def _save_error_details(db: AsyncSession, job: ScrapingJob, stage: str, exc: Exception, **extra):
    """Persist structured error info alongside pipeline_state."""
    current = dict(job.error_details or {})
    current["error"] = {
        "stage": stage,
        "exception_type": type(exc).__name__,
        "message": str(exc),
        "traceback": tb_module.format_exc(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
    job.error_details = current
    job.error_message = f"[{stage}] {type(exc).__name__}: {exc}"
    job.status = "failed"
    await db.commit()


async def _check_job_status(db: AsyncSession, job_id) -> str:
    """Re-read the job status from DB to detect external pause/cancel."""
    await db.flush()  # ensure previous writes are visible
    result = await db.execute(select(ScrapingJob.status).where(ScrapingJob.id == job_id))
    return result.scalar()


async def _append_log(db: AsyncSession, job: ScrapingJob, level: str, stage: str, msg: str):
    """Append a structured log entry to error_details.logs."""
    current = dict(job.error_details or {})
    logs = list(current.get("logs", []))
    logs.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "stage": stage,
        "msg": msg,
    })
    current["logs"] = logs
    job.error_details = current
    await db.commit()


async def _retry_profile_fetch(
    client, rate_limiter, uid: str, max_retries: int = 2,
    tenant_id: str | None = None, max_requests_tenant: int = 3,
) -> dict:
    """Fetch a user profile with retries and exponential backoff."""
    last_exc = None
    for attempt in range(1 + max_retries):
        try:
            if tenant_id:
                await rate_limiter.wait_for_slot_tenant(
                    tenant_id, max_requests_global=settings_rate_limit(),
                    max_requests_tenant=max_requests_tenant)
            else:
                await rate_limiter.wait_for_slot("akng_api_global", max_requests=settings_rate_limit())
            return await client.get_user_profile(uid)
        except Exception as e:
            last_exc = e
            if attempt < max_retries:
                await asyncio.sleep(2.0 ** attempt)  # exponential: 1s, 2s, 4s
    raise last_exc


# Profile fields to copy when resuming
_PROFILE_FIELDS = [
    "first_name", "last_name", "gender", "birthday", "relationship_status",
    "education", "work", "position", "hometown", "location", "website",
    "languages", "username_link", "username", "about", "phone", "picture_url",
    "raw_data",
]


# ── Main Pipeline ────────────────────────────────────────────────────


@celery_app.task(
    bind=True,
    name="app.scraping.tasks.run_scraping_pipeline",
    soft_time_limit=1800,   # 30 min — triggers SoftTimeLimitExceeded
    time_limit=2100,        # 35 min — hard SIGKILL if task still alive
)
def run_scraping_pipeline(self, job_id: str):
    """Entry point for Celery. Runs the async pipeline in an event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_execute_pipeline(job_id, self))
    finally:
        loop.close()


async def _execute_pipeline(job_id: str, celery_task):
    """Execute the full 5-stage scraping pipeline with state persistence and resume support."""
    client = FacebookGraphClient()
    mapper = FacebookProfileMapper()
    rate_limiter = RateLimiter()

    # Create a fresh engine per invocation to avoid stale event loop issues
    # with Celery prefork workers (each task gets a new event loop via asyncio.new_event_loop)
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker as local_async_sessionmaker, AsyncSession as LocalAsyncSession
    from app.config import get_settings as _get_settings
    _settings = _get_settings()
    local_engine = create_async_engine(
        _settings.async_database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
    )
    local_session = local_async_sessionmaker(local_engine, class_=LocalAsyncSession, expire_on_commit=False)

    try:
        async with local_session() as db:
            # Load job
            result = await db.execute(select(ScrapingJob).where(ScrapingJob.id == job_id))
            job = result.scalar_one_or_none()
            if not job:
                logger.error(f"Job {job_id} not found")
                return

            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await db.commit()

            await _append_log(db, job, "info", "start", "Job started")

            # Publish initial "running" state to SSE subscribers
            publish_job_progress(str(job.id), _build_progress_event(job, "start"))

            # Load tenant for plan-based defaults
            _tenant_result = await db.execute(
                select(Tenant).where(Tenant.id == job.tenant_id)
            )
            _tenant = _tenant_result.scalar_one_or_none()

            # Read job settings
            job_settings = job.settings or {}
            profile_retry_count = min(int(job_settings.get("profile_retry_count", 2)), 3)
            resume_from_job_id = job_settings.get("resume_from_job_id")
            _tenant_id_str = str(job.tenant_id)

            # Load original job if resuming
            original_job = None
            orig_state = {}
            if resume_from_job_id:
                orig_result = await db.execute(
                    select(ScrapingJob).where(ScrapingJob.id == resume_from_job_id)
                )
                original_job = orig_result.scalar_one_or_none()
                if original_job:
                    orig_state = (original_job.error_details or {}).get("pipeline_state", {})

            try:
                # ── STAGE 1: Parse input ─────────────────────────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "parse_input")
                    await _append_log(db, job, "warn", "parse_input", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), _build_progress_event(job, "parse_input"))
                    return

                logger.info(f"[Job {job_id}] Stage 1: Parsing input")
                await _append_log(db, job, "info", "parse_input", "Parsing input URL")
                parsed = client.parse_post_url(job.input_value)
                post_id = parsed["post_id"]
                is_group = parsed["is_group"]
                job.input_metadata = parsed
                job.progress_pct = _calc_stage_progress("parse_input")
                await _save_pipeline_state(db, job, "parse_input")
                publish_job_progress(str(job.id), _build_progress_event(job, "parse_input"))

                # ── STAGE 1.5: Fetch page/author profile ────────
                page_id = parsed.get("page_id")
                if page_id:
                    try:
                        logger.info(f"[Job {job_id}] Stage 1.5: Fetching author profile for {page_id}")
                        await _append_log(db, job, "info", "fetch_author", f"Fetching author profile for {page_id}")
                        _tenant_rate = resolve_setting(_tenant, "api_rate_limit_tenant")
                        await rate_limiter.wait_for_slot_tenant(
                            _tenant_id_str, max_requests_global=settings_rate_limit(),
                            max_requests_tenant=_tenant_rate)
                        author_raw = await client.get_object_details(page_id)
                        author_mapped = mapper.map_object_to_author(author_raw)
                        author_profile = PageAuthorProfile(
                            job_id=job.id,
                            tenant_id=job.tenant_id,
                            platform_object_id=author_mapped["platform_object_id"] or page_id,
                            name=author_mapped["name"],
                            about=author_mapped["about"],
                            category=author_mapped["category"],
                            description=author_mapped["description"],
                            location=author_mapped["location"],
                            phone=author_mapped["phone"],
                            website=author_mapped["website"],
                            picture_url=author_mapped["picture_url"],
                            cover_url=author_mapped["cover_url"],
                            raw_data=author_raw,
                            fetched_at=datetime.now(timezone.utc),
                        )
                        db.add(author_profile)
                        await db.commit()
                        job.progress_pct = _calc_stage_progress("fetch_author")
                        await _save_pipeline_state(db, job, "fetch_author")
                        publish_job_progress(str(job.id), _build_progress_event(
                            job, "fetch_author",
                            {"name": author_mapped.get("name")},
                        ))
                        logger.info(f"[Job {job_id}] Author profile saved: {author_mapped.get('name')}")
                        await _append_log(db, job, "info", "fetch_author", f"Author profile saved: {author_mapped.get('name')}")
                    except Exception as author_err:
                        logger.warning(f"[Job {job_id}] Failed to fetch author profile: {author_err}")
                        await _append_log(db, job, "warn", "fetch_author", f"Failed to fetch author: {author_err}")

                # ── STAGE 2: Fetch comments (paginated) ─────────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "fetch_comments")
                    await _append_log(db, job, "warn", "fetch_comments", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), _build_progress_event(job, "fetch_comments"))
                    return

                logger.info(f"[Job {job_id}] Stage 2: Fetching comments for post {post_id}")
                await _append_log(db, job, "info", "fetch_comments", f"Fetching comments for post {post_id}")
                all_comments = []
                next_cursor = None
                page_count = 0
                total_top_level = 0
                total_replies = 0

                # If resuming, load comments from original job
                if resume_from_job_id and original_job:
                    existing_result = await db.execute(
                        select(ExtractedComment).where(
                            ExtractedComment.job_id == resume_from_job_id
                        )
                    )
                    existing_comments = existing_result.scalars().all()

                    for ec in existing_comments:
                        new_comment = ExtractedComment(
                            job_id=job.id,
                            post_id=ec.post_id,
                            comment_id=ec.comment_id,
                            commenter_user_id=ec.commenter_user_id,
                            commenter_name=ec.commenter_name,
                            comment_text=ec.comment_text,
                        )
                        db.add(new_comment)
                        all_comments.append({
                            "user_id": ec.commenter_user_id,
                            "user_name": ec.commenter_name,
                            "comment_id": ec.comment_id,
                            "message": ec.comment_text,
                        })
                    await db.commit()
                    page_count = len(existing_comments) // 25 + (1 if existing_comments else 0)

                    logger.info(
                        f"[Job {job_id}] Resumed: copied {len(existing_comments)} comments from job {resume_from_job_id}"
                    )

                    # If original failed during fetch_comments with a cursor, continue from there
                    if orig_state.get("current_stage") == "fetch_comments" and orig_state.get("last_cursor"):
                        next_cursor = orig_state["last_cursor"]
                        logger.info(f"[Job {job_id}] Continuing pagination from cursor")
                    else:
                        # Original got past comment fetching; skip to Stage 3
                        next_cursor = None

                # Start from a user-selected cursor (lighter than full resume)
                start_cursor = job_settings.get("start_from_cursor")
                if start_cursor and not resume_from_job_id:
                    next_cursor = start_cursor
                    logger.info(f"[Job {job_id}] Starting from user-selected cursor")

                # Max comment pages: prevent unbounded pagination on viral posts
                _plan_max_comment = resolve_setting(_tenant, "max_comment_pages", job_settings=job_settings)
                max_comment_pages = min(max(int(_plan_max_comment), 1), 1000)

                # Per-tenant rate limit from plan defaults
                _tenant_rate = resolve_setting(_tenant, "api_rate_limit_tenant")

                # Pagination loop (normal or continuing from cursor)
                if not resume_from_job_id or next_cursor:
                    while page_count < max_comment_pages:
                        await rate_limiter.wait_for_slot_tenant(
                            _tenant_id_str,
                            max_requests_global=settings_rate_limit(),
                            max_requests_tenant=_tenant_rate,
                        )

                        # Retry wrapper for timeout / transient errors
                        response = None
                        _max_retries = 3
                        for _attempt in range(_max_retries):
                            try:
                                response = await client.get_post_comments(
                                    post_id,
                                    is_group=is_group,
                                    after=next_cursor,
                                    limit=25,
                                )
                                break
                            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.PoolTimeout) as _te:
                                if _attempt < _max_retries - 1:
                                    _wait = 3 * (2 ** _attempt)  # 3s, 6s, 12s
                                    logger.warning(
                                        f"[Job {job_id}] Comment page {page_count+1} timeout "
                                        f"(attempt {_attempt+1}/{_max_retries}), retrying in {_wait}s"
                                    )
                                    await _append_log(db, job, "warn", "fetch_comments",
                                        f"Timeout on page {page_count+1}, retrying ({_attempt+1}/{_max_retries})")
                                    await asyncio.sleep(_wait)
                                else:
                                    raise

                        logger.info(
                            "[Job %s] Raw comments response keys: %s, first 500 chars: %s",
                            job_id, list(response.keys()), str(response)[:500],
                        )

                        extracted = mapper.extract_comments_data(response, is_group=is_group)
                        all_comments.extend(extracted["comments"])
                        total_top_level += extracted.get("top_level_count", 0)
                        total_replies += extracted.get("reply_count", 0)
                        page_count += 1

                        # Store comments in DB
                        for c in extracted["comments"]:
                            comment = ExtractedComment(
                                job_id=job.id,
                                post_id=post_id,
                                comment_id=c["comment_id"],
                                commenter_user_id=c["user_id"],
                                commenter_name=c["user_name"],
                                comment_text=c["message"],
                            )
                            db.add(comment)

                        # Save cursor after each page
                        next_cursor = extracted.get("next_cursor")
                        job.progress_pct = _calc_stage_progress("fetch_comments", pages_fetched=page_count)
                        await _save_pipeline_state(
                            db, job, "fetch_comments",
                            comment_pages_fetched=page_count,
                            last_cursor=next_cursor,
                            total_comments_fetched=len(all_comments),
                            top_level_comments=total_top_level,
                            reply_comments=total_replies,
                        )

                        # Publish progress after each page
                        publish_job_progress(str(job.id), _build_progress_event(
                            job, "fetch_comments",
                            {"pages_fetched": page_count, "total_comments": len(all_comments),
                             "top_level_comments": total_top_level, "reply_comments": total_replies},
                        ))

                        # Check for pause/cancel after each page fetch
                        current_status = await _check_job_status(db, job.id)
                        if current_status in ("paused", "cancelled"):
                            job.status = current_status
                            await _save_pipeline_state(
                                db, job, "fetch_comments",
                                comment_pages_fetched=page_count,
                                last_cursor=next_cursor,
                                total_comments_fetched=len(all_comments),
                                top_level_comments=total_top_level,
                                reply_comments=total_replies,
                            )
                            await _append_log(db, job, "warn", "fetch_comments", f"Job {current_status} by user after {page_count} pages")
                            publish_job_progress(str(job.id), _build_progress_event(job, "fetch_comments"))
                            return

                        if not extracted["has_next"] or not next_cursor:
                            break

                    # Log if stopped due to page limit
                    if page_count >= max_comment_pages and next_cursor:
                        logger.info(f"[Job {job_id}] Stopped at max_comment_pages={max_comment_pages}")
                        await _append_log(db, job, "info", "fetch_comments",
                            f"Reached comment page limit ({max_comment_pages}). Use resume to continue.")

                logger.info(f"[Job {job_id}] Fetched {len(all_comments)} total ({total_top_level} comments + {total_replies} replies) from {page_count} pages")
                await _append_log(db, job, "info", "fetch_comments", f"Fetched {total_top_level} comments + {total_replies} replies = {len(all_comments)} total from {page_count} pages")

                # ── STAGE 3: Extract & deduplicate user IDs ──────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "deduplicate")
                    await _append_log(db, job, "warn", "deduplicate", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), _build_progress_event(job, "deduplicate"))
                    return

                logger.info(f"[Job {job_id}] Stage 3: Deduplicating user IDs")
                await _append_log(db, job, "info", "deduplicate", "Deduplicating user IDs")
                unique_users = {}
                for c in all_comments:
                    uid = c["user_id"]
                    if uid and uid not in unique_users:
                        unique_users[uid] = c["user_name"]

                # Cross-job deduplication: skip users already scraped for this post
                # Check system-level feature flag first
                dedup_enabled = True
                try:
                    from app.models.system import SystemSetting
                    ff_result = await db.execute(
                        select(SystemSetting).where(SystemSetting.key == "feature_flag_dedup_save_credits")
                    )
                    ff = ff_result.scalar_one_or_none()
                    if ff and not ff.value.get("enabled", True):
                        dedup_enabled = False
                except Exception:
                    # Rollback to clear any invalid transaction state
                    # (e.g. if system_settings table doesn't exist)
                    try:
                        await db.rollback()
                    except Exception:
                        pass
                if dedup_enabled and job_settings.get("ignore_duplicate_users"):
                    prev_profiles = await db.execute(
                        select(ScrapedProfile.platform_user_id)
                        .join(ScrapingJob, ScrapedProfile.job_id == ScrapingJob.id)
                        .where(
                            ScrapingJob.tenant_id == job.tenant_id,
                            ScrapingJob.input_value == job.input_value,
                            ScrapingJob.id != job.id,
                            ScrapedProfile.scrape_status == "success",
                        )
                    )
                    already_scraped = {r[0] for r in prev_profiles.all()}
                    dupes_removed = 0
                    for uid in already_scraped:
                        if unique_users.pop(uid, None) is not None:
                            dupes_removed += 1
                    if dupes_removed:
                        logger.info(f"[Job {job_id}] Skipped {dupes_removed} duplicate users from previous jobs")

                user_ids = list(unique_users.keys())
                job.total_items = len(user_ids)
                job.progress_pct = _calc_stage_progress("deduplicate")
                await _save_pipeline_state(
                    db, job, "deduplicate",
                    unique_user_ids_found=len(user_ids),
                )
                publish_job_progress(str(job.id), _build_progress_event(
                    job, "deduplicate",
                    {"unique_users": len(user_ids), "total_comments": len(all_comments)},
                ))

                logger.info(f"[Job {job_id}] Found {len(user_ids)} unique users from {len(all_comments)} comments")
                await _append_log(db, job, "info", "deduplicate", f"Found {len(user_ids)} unique users from {len(all_comments)} comments")

                # Check credit balance
                logger.info(f"[Job {job_id}] Step: checking credit balance for tenant {job.tenant_id}")
                balance_result = await db.execute(
                    select(CreditBalance).where(CreditBalance.tenant_id == job.tenant_id)
                )
                balance = balance_result.scalar_one_or_none()
                logger.info(f"[Job {job_id}] Step: credit balance = {balance.balance if balance else 'NO_ROW'}")

                # For resumed jobs, only estimate cost for new work
                skip_user_ids = set()
                if resume_from_job_id and original_job:
                    # Load already-enriched profiles from original job
                    orig_profiles_result = await db.execute(
                        select(ScrapedProfile).where(
                            ScrapedProfile.job_id == resume_from_job_id,
                            ScrapedProfile.scrape_status == "success",
                        )
                    )
                    orig_profiles = orig_profiles_result.scalars().all()
                    skip_user_ids = {op.platform_user_id for op in orig_profiles if op.platform_user_id in unique_users}

                # Only charge for new pages (fetched in this run) + new profiles to enrich
                if resume_from_job_id:
                    new_pages = max(0, page_count - (orig_state.get("comment_pages_fetched", 0)))
                else:
                    new_pages = page_count
                estimated_cost = (len(user_ids) - len(skip_user_ids)) + new_pages
                logger.info(f"[Job {job_id}] Step: estimated_cost={estimated_cost} (users={len(user_ids)}, pages={new_pages})")

                job.credits_estimated = estimated_cost

                if not balance or balance.balance < estimated_cost:
                    job.status = "failed"
                    job.error_message = f"Insufficient credits. Need {estimated_cost}, have {balance.balance if balance else 0}"
                    await _append_log(db, job, "error", "deduplicate", f"Insufficient credits: need {estimated_cost}, have {balance.balance if balance else 0}")
                    await db.commit()
                    publish_job_progress(str(job.id), _build_progress_event(job, "deduplicate"))
                    return

                logger.info(f"[Job {job_id}] Step: credit check passed, creating {len(unique_users)} ScrapedProfile rows")
                # Create ScrapedProfile rows for ALL unique users
                for uid, uname in unique_users.items():
                    profile = ScrapedProfile(
                        job_id=job.id,
                        tenant_id=job.tenant_id,
                        platform_user_id=uid,
                        name=uname,
                        scrape_status="pending",
                    )
                    db.add(profile)
                await db.commit()
                logger.info(f"[Job {job_id}] Step: ScrapedProfile rows committed OK")

                # Copy enriched data from original job for profiles we're skipping
                if skip_user_ids:
                    orig_profiles_result = await db.execute(
                        select(ScrapedProfile).where(
                            ScrapedProfile.job_id == resume_from_job_id,
                            ScrapedProfile.scrape_status == "success",
                        )
                    )
                    orig_profiles = orig_profiles_result.scalars().all()
                    for op in orig_profiles:
                        if op.platform_user_id in skip_user_ids:
                            new_p_result = await db.execute(
                                select(ScrapedProfile).where(
                                    ScrapedProfile.job_id == job.id,
                                    ScrapedProfile.platform_user_id == op.platform_user_id,
                                )
                            )
                            new_p = new_p_result.scalar_one_or_none()
                            if new_p:
                                for field in _PROFILE_FIELDS:
                                    setattr(new_p, field, getattr(op, field))
                                new_p.scrape_status = "success"
                                new_p.scraped_at = op.scraped_at
                    await db.commit()
                    logger.info(f"[Job {job_id}] Copied {len(skip_user_ids)} enriched profiles from original job")

                # Build list of profiles to actually fetch
                user_ids_to_enrich = [uid for uid in user_ids if uid not in skip_user_ids]
                logger.info(f"[Job {job_id}] Step: {len(user_ids_to_enrich)} users to enrich")

                # ── STAGE 4: Enrich profiles ─────────────────────
                # Check status before starting stage
                logger.info(f"[Job {job_id}] Step: checking job status before enrich")
                current_status = await _check_job_status(db, job.id)
                logger.info(f"[Job {job_id}] Step: job status = {current_status}")
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "enrich_profiles")
                    await _append_log(db, job, "warn", "enrich_profiles", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), _build_progress_event(job, "enrich_profiles"))
                    return

                logger.info(f"[Job {job_id}] Stage 4: Starting profile enrichment for {len(user_ids_to_enrich)} users ({len(skip_user_ids)} skipped)")
                await _append_log(db, job, "info", "enrich_profiles", f"Enriching {len(user_ids_to_enrich)} profiles ({len(skip_user_ids)} skipped)")
                already_done = len(skip_user_ids)
                credits_used = new_pages if resume_from_job_id else page_count
                job.progress_pct = _calc_stage_progress("enrich_profiles", done=already_done, total=len(user_ids))
                publish_job_progress(str(job.id), _build_progress_event(
                    job, "enrich_profiles",
                    {"profiles_done": already_done, "profiles_total": len(user_ids),
                     "profiles_failed": 0},
                ))

                for i, uid in enumerate(user_ids_to_enrich):
                    try:
                        logger.info(f"[Job {job_id}] Enriching profile {i+1}/{len(user_ids_to_enrich)}: {uid}")
                        profile_data = await _retry_profile_fetch(
                            client, rate_limiter, uid, max_retries=profile_retry_count,
                            tenant_id=_tenant_id_str,
                            max_requests_tenant=_tenant_rate,
                        )
                        logger.info(f"[Job {job_id}] Profile {uid}: got {len(profile_data) if profile_data else 0} fields")
                        mapped = mapper.map_to_standard(profile_data)

                        # Update ScrapedProfile
                        profile_result = await db.execute(
                            select(ScrapedProfile).where(
                                ScrapedProfile.job_id == job.id,
                                ScrapedProfile.platform_user_id == uid,
                            )
                        )
                        profile = profile_result.scalar_one_or_none()
                        if profile:
                            profile.name = mapped["Name"]
                            profile.first_name = mapped["First Name"]
                            profile.last_name = mapped["Last Name"]
                            profile.gender = mapped["Gender"]
                            profile.birthday = mapped["Birthday"]
                            profile.relationship_status = mapped["Relationship"]
                            profile.education = mapped["Education"]
                            profile.work = mapped["Work"]
                            profile.position = mapped["Position"]
                            profile.hometown = mapped["Hometown"]
                            profile.location = mapped["Location"]
                            profile.website = mapped["Website"]
                            profile.languages = mapped["Languages"]
                            profile.username_link = mapped["UsernameLink"]
                            profile.username = mapped["Username"]
                            profile.about = mapped["About"]
                            profile.phone = mapped["Phone"]
                            profile.picture_url = mapped["Picture URL"]
                            profile.raw_data = profile_data
                            profile.scrape_status = "success"
                            profile.scraped_at = datetime.now(timezone.utc)

                        credits_used += 1

                    except Exception as e:
                        logger.warning(
                            f"[Job {job_id}] Failed to fetch profile {uid} "
                            f"after {profile_retry_count} retries: {e}"
                        )
                        profile_result = await db.execute(
                            select(ScrapedProfile).where(
                                ScrapedProfile.job_id == job.id,
                                ScrapedProfile.platform_user_id == uid,
                            )
                        )
                        profile = profile_result.scalar_one_or_none()
                        if profile:
                            profile.scrape_status = "failed"
                            profile.error_message = str(e)
                        job.failed_items += 1

                    total_done = already_done + i + 1
                    job.processed_items = total_done
                    job.progress_pct = _calc_stage_progress(
                        "enrich_profiles", done=total_done, total=len(user_ids),
                    )
                    await _save_pipeline_state(
                        db, job, "enrich_profiles",
                        profiles_enriched=total_done,
                        profiles_failed=job.failed_items,
                    )

                    # Check for pause/cancel every 5 profiles
                    if (i + 1) % 5 == 0:
                        current_status = await _check_job_status(db, job.id)
                        if current_status in ("paused", "cancelled"):
                            job.status = current_status
                            await _save_pipeline_state(
                                db, job, "enrich_profiles",
                                profiles_enriched=total_done,
                                profiles_failed=job.failed_items,
                            )
                            await _append_log(db, job, "warn", "enrich_profiles", f"Job {current_status} by user after {total_done} profiles")
                            publish_job_progress(str(job.id), _build_progress_event(job, "enrich_profiles"))
                            return

                    # Update Celery task state for progress tracking
                    celery_task.update_state(
                        state="PROGRESS",
                        meta={
                            "current": total_done,
                            "total": len(user_ids),
                            "percent": job.progress_pct,
                        },
                    )

                    # Publish progress to SSE subscribers
                    publish_job_progress(str(job.id), _build_progress_event(
                        job, "enrich_profiles",
                        {"profiles_done": total_done, "profiles_total": len(user_ids),
                         "profiles_failed": job.failed_items},
                    ))

                # ── STAGE 5: Finalize ────────────────────────────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "finalize")
                    await _append_log(db, job, "warn", "finalize", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), _build_progress_event(job, "finalize"))
                    return

                logger.info(f"[Job {job_id}] Stage 5: Compiling results")
                await _append_log(db, job, "info", "finalize", "Compiling results")
                job.credits_used = credits_used
                job.status = "completed"
                job.completed_at = datetime.now(timezone.utc)
                job.progress_pct = _calc_stage_progress("finalize")

                # Count successful results
                count_result = await db.execute(
                    select(func.count(ScrapedProfile.id)).where(
                        ScrapedProfile.job_id == job.id,
                        ScrapedProfile.scrape_status == "success",
                    )
                )
                job.result_row_count = count_result.scalar() or 0

                # Debit credits
                if balance:
                    balance.balance -= credits_used
                    balance.lifetime_used += credits_used

                    tx = CreditTransaction(
                        tenant_id=job.tenant_id,
                        user_id=job.user_id,
                        type="usage",
                        amount=-credits_used,
                        balance_after=balance.balance,
                        description=f"Scraping job: {job.result_row_count} profiles",
                        reference_type="scraping_job",
                        reference_id=job.id,
                    )
                    db.add(tx)

                await _save_pipeline_state(db, job, "finalize")

                await _append_log(db, job, "info", "finalize", f"Completed: {job.result_row_count} profiles, {credits_used} credits used")

                # Publish completion to SSE subscribers
                publish_job_progress(str(job.id), _build_progress_event(job, "finalize"))

                logger.info(
                    f"[Job {job_id}] Completed: {job.result_row_count} profiles, "
                    f"{credits_used} credits used"
                )

                # Send Telegram notification
                try:
                    from app.services.tenant_config import get_telegram_config
                    from app.services.telegram_notify import send_job_completion_notification

                    tg_config = await get_telegram_config(db, job.tenant_id)
                    token = tg_config["bot_token"]

                    user_result = await db.execute(
                        select(User).where(User.id == job.user_id)
                    )
                    job_user = user_result.scalar_one_or_none()
                    if job_user and job_user.telegram_chat_id:
                        await send_job_completion_notification(
                            job_user.telegram_chat_id, job, bot_token=token
                        )

                    tenant_chat_id = tg_config.get("notification_chat_id")
                    user_chat = job_user.telegram_chat_id if job_user else None
                    if tenant_chat_id and tenant_chat_id != user_chat:
                        await send_job_completion_notification(
                            tenant_chat_id, job, bot_token=token
                        )
                except Exception as notify_err:
                    logger.warning(f"[Job {job_id}] Telegram notification failed: {notify_err}")

            except Exception as e:
                from celery.exceptions import SoftTimeLimitExceeded
                is_timeout = isinstance(e, SoftTimeLimitExceeded)
                if is_timeout:
                    logger.warning(f"[Job {job_id}] Task hit soft time limit (30 min), saving state for resume")
                else:
                    logger.exception(f"[Job {job_id}] Pipeline failed: {e}")
                try:
                    current_state = (job.error_details or {}).get("pipeline_state", {})
                    failed_stage = current_state.get("current_stage", "unknown")
                    if is_timeout:
                        job.status = "failed"
                        job.error_message = f"[{failed_stage}] Task timed out after 30 minutes. Use resume to continue."
                        await db.commit()
                        await _append_log(db, job, "error", failed_stage, "Task timed out (30 min limit). State saved — use resume to continue.")
                    else:
                        await _save_error_details(db, job, failed_stage, e)
                        await _append_log(db, job, "error", failed_stage, f"Pipeline failed: {type(e).__name__}: {e}")
                except Exception as save_err:
                    logger.error(f"[Job {job_id}] Failed to save error details: {save_err}")

                # Publish failure to SSE subscribers
                try:
                    publish_job_progress(str(job.id), _build_progress_event(job, "error"))
                except Exception:
                    pass

                # Send failure notification
                try:
                    from app.services.tenant_config import get_telegram_config
                    from app.services.telegram_notify import send_job_completion_notification

                    tg_config = await get_telegram_config(db, job.tenant_id)
                    token = tg_config["bot_token"]

                    user_result = await db.execute(
                        select(User).where(User.id == job.user_id)
                    )
                    job_user = user_result.scalar_one_or_none()
                    if job_user and job_user.telegram_chat_id:
                        await send_job_completion_notification(
                            job_user.telegram_chat_id, job, bot_token=token
                        )

                    tenant_chat_id = tg_config.get("notification_chat_id")
                    user_chat = job_user.telegram_chat_id if job_user else None
                    if tenant_chat_id and tenant_chat_id != user_chat:
                        await send_job_completion_notification(
                            tenant_chat_id, job, bot_token=token
                        )
                except Exception as notify_err:
                    logger.warning(f"[Job {job_id}] Telegram notification failed: {notify_err}")

    except Exception as outer_err:
        # Fallback: if the DB session itself is broken (e.g., event loop mismatch),
        # create a fresh session to mark the job as failed
        logger.exception(f"[Job {job_id}] Pipeline crashed (session-level error): {outer_err}")
        try:
            async with local_session() as fallback_db:
                result = await fallback_db.execute(
                    select(ScrapingJob).where(ScrapingJob.id == job_id)
                )
                fallback_job = result.scalar_one_or_none()
                if fallback_job and fallback_job.status == "running":
                    fallback_job.status = "failed"
                    fallback_job.error_message = f"Pipeline crashed: {type(outer_err).__name__}: {outer_err}"
                    await fallback_db.commit()
                    logger.info(f"[Job {job_id}] Marked as failed via fallback session")
                    publish_job_progress(str(job_id), {
                        "status": "failed",
                        "progress_pct": 0,
                        "current_stage": "error",
                        "stage_data": {"error": str(outer_err)},
                    })
        except Exception as fallback_err:
            logger.error(f"[Job {job_id}] Fallback error save also failed: {fallback_err}")

    finally:
        await client.close()
        await rate_limiter.close()
        await local_engine.dispose()


def settings_rate_limit() -> int:
    """Get the global rate limit setting."""
    from app.config import get_settings
    return get_settings().akng_rate_limit_per_second


@celery_app.task(name="app.scraping.tasks.check_scheduled_jobs")
def check_scheduled_jobs():
    """Periodic task: find and dispatch scheduled jobs that are due."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_check_and_dispatch_scheduled())
    finally:
        loop.close()


async def _check_and_dispatch_scheduled():
    # Create a fresh engine per invocation to avoid stale event loop issues
    # with Celery prefork workers (each task gets a new event loop)
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.config import get_settings

    settings = get_settings()
    local_engine = create_async_engine(settings.async_database_url, pool_pre_ping=True)
    local_session = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with local_session() as db:
            now = datetime.now(timezone.utc)
            result = await db.execute(
                select(ScrapingJob).where(
                    ScrapingJob.status == "scheduled",
                    ScrapingJob.scheduled_at <= now,
                ).order_by(ScrapingJob.scheduled_at.asc())
            )
            jobs = result.scalars().all()
            dispatched = 0
            skipped = 0
            for job in jobs:
                # Re-check concurrent job limit per tenant before dispatching
                running_result = await db.execute(
                    select(func.count(ScrapingJob.id)).where(
                        ScrapingJob.tenant_id == job.tenant_id,
                        ScrapingJob.status.in_(["running", "queued"]),
                    )
                )
                running_count = running_result.scalar() or 0
                tenant_result = await db.execute(
                    select(Tenant).where(Tenant.id == job.tenant_id)
                )
                tenant = tenant_result.scalar_one_or_none()
                max_concurrent = resolve_setting(tenant, "max_concurrent_jobs")

                if running_count >= max_concurrent:
                    skipped += 1
                    continue  # leave as "scheduled", will be picked up next cycle

                job.status = "queued"
                if job.job_type == "post_discovery":
                    from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
                    task = run_post_discovery_pipeline.delay(str(job.id))
                else:
                    task = run_scraping_pipeline.delay(str(job.id))
                job.celery_task_id = task.id
                dispatched += 1
            await db.commit()

            if dispatched or skipped:
                logger.info(f"Scheduled jobs: dispatched={dispatched}, deferred={skipped}")
    finally:
        await local_engine.dispose()
