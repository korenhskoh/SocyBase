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
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session
from app.models.job import ScrapingJob, ScrapedProfile, ExtractedComment, PageAuthorProfile
from app.models.credit import CreditBalance, CreditTransaction
from app.models.user import User
from app.scraping.clients.facebook import FacebookGraphClient
from app.scraping.mappers.facebook_mapper import FacebookProfileMapper
from app.scraping.rate_limiter import RateLimiter
from app.celery_app import celery_app
from app.services.progress_publisher import publish_job_progress

logger = logging.getLogger(__name__)

# ── Helpers ──────────────────────────────────────────────────────────


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


async def _retry_profile_fetch(client, rate_limiter, uid: str, max_retries: int = 2) -> dict:
    """Fetch a user profile with retries and linear backoff."""
    last_exc = None
    for attempt in range(1 + max_retries):
        try:
            await rate_limiter.wait_for_slot("akng_api_global", max_requests=settings_rate_limit())
            return await client.get_user_profile(uid)
        except Exception as e:
            last_exc = e
            if attempt < max_retries:
                await asyncio.sleep(1.0 * (attempt + 1))
    raise last_exc


# Profile fields to copy when resuming
_PROFILE_FIELDS = [
    "first_name", "last_name", "gender", "birthday", "relationship_status",
    "education", "work", "position", "hometown", "location", "website",
    "languages", "username_link", "username", "about", "phone", "picture_url",
    "raw_data",
]


# ── Main Pipeline ────────────────────────────────────────────────────


@celery_app.task(bind=True, name="app.scraping.tasks.run_scraping_pipeline")
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

    try:
        async with async_session() as db:
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
            publish_job_progress(str(job.id), {
                "status": job.status,
                "progress_pct": float(job.progress_pct),
                "processed_items": job.processed_items,
                "total_items": job.total_items,
                "failed_items": job.failed_items,
                "result_row_count": job.result_row_count,
            })

            # Read job settings
            job_settings = job.settings or {}
            profile_retry_count = min(int(job_settings.get("profile_retry_count", 2)), 3)
            resume_from_job_id = job_settings.get("resume_from_job_id")

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
                    publish_job_progress(str(job.id), {
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    })
                    return

                logger.info(f"[Job {job_id}] Stage 1: Parsing input")
                await _append_log(db, job, "info", "parse_input", "Parsing input URL")
                parsed = client.parse_post_url(job.input_value)
                post_id = parsed["post_id"]
                is_group = parsed["is_group"]
                job.input_metadata = parsed
                await _save_pipeline_state(db, job, "parse_input")

                # ── STAGE 1.5: Fetch page/author profile ────────
                page_id = parsed.get("page_id")
                if page_id:
                    try:
                        logger.info(f"[Job {job_id}] Stage 1.5: Fetching author profile for {page_id}")
                        await _append_log(db, job, "info", "fetch_author", f"Fetching author profile for {page_id}")
                        await rate_limiter.wait_for_slot("akng_api_global", max_requests=settings_rate_limit())
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
                        await _save_pipeline_state(db, job, "fetch_author")
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
                    publish_job_progress(str(job.id), {
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    })
                    return

                logger.info(f"[Job {job_id}] Stage 2: Fetching comments for post {post_id}")
                await _append_log(db, job, "info", "fetch_comments", f"Fetching comments for post {post_id}")
                all_comments = []
                next_cursor = None
                page_count = 0

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

                # Pagination loop (normal or continuing from cursor)
                if not resume_from_job_id or next_cursor:
                    while True:
                        await rate_limiter.wait_for_slot(
                            "akng_api_global",
                            max_requests=settings_rate_limit(),
                        )

                        response = await client.get_post_comments(
                            post_id,
                            is_group=is_group,
                            after=next_cursor,
                            limit=25,
                        )

                        logger.info(
                            "[Job %s] Raw comments response keys: %s, first 500 chars: %s",
                            job_id, list(response.keys()), str(response)[:500],
                        )

                        extracted = mapper.extract_comments_data(response, is_group=is_group)
                        all_comments.extend(extracted["comments"])
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
                        await _save_pipeline_state(
                            db, job, "fetch_comments",
                            comment_pages_fetched=page_count,
                            last_cursor=next_cursor,
                            total_comments_fetched=len(all_comments),
                        )

                        # Check for pause/cancel after each page fetch
                        current_status = await _check_job_status(db, job.id)
                        if current_status in ("paused", "cancelled"):
                            job.status = current_status
                            await _save_pipeline_state(
                                db, job, "fetch_comments",
                                comment_pages_fetched=page_count,
                                last_cursor=next_cursor,
                                total_comments_fetched=len(all_comments),
                            )
                            await _append_log(db, job, "warn", "fetch_comments", f"Job {current_status} by user after {page_count} pages")
                            publish_job_progress(str(job.id), {
                                "status": job.status,
                                "progress_pct": float(job.progress_pct),
                                "processed_items": job.processed_items,
                                "total_items": job.total_items,
                                "failed_items": job.failed_items,
                                "result_row_count": job.result_row_count,
                            })
                            return

                        if not extracted["has_next"] or not next_cursor:
                            break

                logger.info(f"[Job {job_id}] Fetched {len(all_comments)} comments from {page_count} pages")
                await _append_log(db, job, "info", "fetch_comments", f"Fetched {len(all_comments)} comments from {page_count} pages")

                # ── STAGE 3: Extract & deduplicate user IDs ──────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "deduplicate")
                    await _append_log(db, job, "warn", "deduplicate", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), {
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    })
                    return

                logger.info(f"[Job {job_id}] Stage 3: Deduplicating user IDs")
                await _append_log(db, job, "info", "deduplicate", "Deduplicating user IDs")
                unique_users = {}
                for c in all_comments:
                    uid = c["user_id"]
                    if uid and uid not in unique_users:
                        unique_users[uid] = c["user_name"]

                # Cross-job deduplication: skip users already scraped for this post
                if job_settings.get("ignore_duplicate_users"):
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
                await _save_pipeline_state(
                    db, job, "deduplicate",
                    unique_user_ids_found=len(user_ids),
                )

                logger.info(f"[Job {job_id}] Found {len(user_ids)} unique users")
                await _append_log(db, job, "info", "deduplicate", f"Found {len(user_ids)} unique users")

                # Check credit balance
                balance_result = await db.execute(
                    select(CreditBalance).where(CreditBalance.tenant_id == job.tenant_id)
                )
                balance = balance_result.scalar_one_or_none()

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

                job.credits_estimated = estimated_cost

                if not balance or balance.balance < estimated_cost:
                    job.status = "failed"
                    job.error_message = f"Insufficient credits. Need {estimated_cost}, have {balance.balance if balance else 0}"
                    await _append_log(db, job, "error", "deduplicate", f"Insufficient credits: need {estimated_cost}, have {balance.balance if balance else 0}")
                    await db.commit()
                    return

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

                # ── STAGE 4: Enrich profiles ─────────────────────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "enrich_profiles")
                    await _append_log(db, job, "warn", "enrich_profiles", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), {
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    })
                    return

                logger.info(f"[Job {job_id}] Stage 4: Enriching {len(user_ids_to_enrich)} profiles ({len(skip_user_ids)} skipped)")
                await _append_log(db, job, "info", "enrich_profiles", f"Enriching {len(user_ids_to_enrich)} profiles ({len(skip_user_ids)} skipped)")
                credits_used = new_pages if resume_from_job_id else page_count
                already_done = len(skip_user_ids)

                for i, uid in enumerate(user_ids_to_enrich):
                    try:
                        profile_data = await _retry_profile_fetch(
                            client, rate_limiter, uid, max_retries=profile_retry_count
                        )
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
                    job.progress_pct = round(total_done / len(user_ids) * 100, 2)
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
                            publish_job_progress(str(job.id), {
                                "status": job.status,
                                "progress_pct": float(job.progress_pct),
                                "processed_items": job.processed_items,
                                "total_items": job.total_items,
                                "failed_items": job.failed_items,
                                "result_row_count": job.result_row_count,
                            })
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
                    publish_job_progress(str(job.id), {
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    })

                # ── STAGE 5: Finalize ────────────────────────────
                # Check status before starting stage
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "finalize")
                    await _append_log(db, job, "warn", "finalize", f"Job {current_status} by user")
                    publish_job_progress(str(job.id), {
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    })
                    return

                logger.info(f"[Job {job_id}] Stage 5: Compiling results")
                await _append_log(db, job, "info", "finalize", "Compiling results")
                job.credits_used = credits_used
                job.status = "completed"
                job.completed_at = datetime.now(timezone.utc)

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
                publish_job_progress(str(job.id), {
                    "status": job.status,
                    "progress_pct": float(job.progress_pct),
                    "processed_items": job.processed_items,
                    "total_items": job.total_items,
                    "failed_items": job.failed_items,
                    "result_row_count": job.result_row_count,
                })

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
                logger.exception(f"[Job {job_id}] Pipeline failed: {e}")
                current_state = (job.error_details or {}).get("pipeline_state", {})
                failed_stage = current_state.get("current_stage", "unknown")
                await _save_error_details(db, job, failed_stage, e)
                await _append_log(db, job, "error", failed_stage, f"Pipeline failed: {type(e).__name__}: {e}")

                # Publish failure to SSE subscribers
                publish_job_progress(str(job.id), {
                    "status": job.status,
                    "progress_pct": float(job.progress_pct),
                    "processed_items": job.processed_items,
                    "total_items": job.total_items,
                    "failed_items": job.failed_items,
                    "result_row_count": job.result_row_count,
                })

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

    finally:
        await client.close()
        await rate_limiter.close()


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
                )
            )
            jobs = result.scalars().all()
            for job in jobs:
                job.status = "queued"
                if job.job_type == "post_discovery":
                    from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
                    task = run_post_discovery_pipeline.delay(str(job.id))
                else:
                    task = run_scraping_pipeline.delay(str(job.id))
                job.celery_task_id = task.id
            await db.commit()

            if jobs:
                logger.info(f"Dispatched {len(jobs)} scheduled jobs")
    finally:
        await local_engine.dispose()
