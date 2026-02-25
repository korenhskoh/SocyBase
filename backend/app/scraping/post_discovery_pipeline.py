"""
Post Discovery Pipeline

Discovers posts from a Facebook page, group, or profile feed.
3-stage pipeline:
  1. Parse Input (extract page/group ID)
  2. Fetch Posts (paginated feed traversal)
  3. Finalize (credits, notifications)

Registered as Celery task: app.scraping.tasks.run_post_discovery_pipeline
"""
import asyncio
import logging
from datetime import datetime, timezone

import httpx

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.job import ScrapingJob, ScrapedPost, PageAuthorProfile
from app.models.credit import CreditBalance, CreditTransaction
from app.models.user import User
from app.scraping.clients.facebook import FacebookGraphClient
from app.scraping.mappers.facebook_mapper import FacebookProfileMapper
from app.scraping.rate_limiter import RateLimiter
from app.celery_app import celery_app
from app.services.progress_publisher import publish_job_progress
from app.scraping.pipeline import (
    _save_pipeline_state,
    _save_error_details,
    _check_job_status,
    _append_log,
    settings_rate_limit,
)

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────


def _parse_dt(val) -> datetime | None:
    """Parse an ISO-8601 datetime string from the AKNG API."""
    if not val:
        return None
    try:
        return datetime.fromisoformat(val)
    except (ValueError, TypeError):
        return None


def _extract_post_fields(item: dict) -> dict:
    """Extract standardised post fields from a single feed item."""
    post_id = item["id"]
    from_info = item.get("from", {}) or {}
    from_name = from_info.get("name")
    from_id = from_info.get("id")

    # Engagement metrics — handle multiple API response shapes:
    #   Shape A: {"comments": {"count": 170}}
    #   Shape B: {"comments": {"summary": {"total_count": 170}}}
    comments_obj = item.get("comments") or {}
    comment_count = (
        comments_obj.get("count")
        or comments_obj.get("summary", {}).get("total_count")
        or 0
    )
    reactions_obj = item.get("reactions") or {}
    reaction_count = (
        reactions_obj.get("count")
        or reactions_obj.get("summary", {}).get("total_count")
        or 0
    )
    share_count = (item.get("shares") or {}).get("count", 0)

    # Attachments
    attachments_data = (item.get("attachments") or {}).get("data", [])
    first_attachment = attachments_data[0] if attachments_data else {}
    attachment_type = first_attachment.get("type") if first_attachment else None
    attachment_url = None
    if first_attachment:
        # Prefer unshimmed_url > url > media.image.src
        attachment_url = (
            first_attachment.get("unshimmed_url")
            or first_attachment.get("url")
            or (first_attachment.get("media") or {}).get("image", {}).get("src")
        )

    # Post URL: prefer attachments target URL, fall back to constructed URL
    target_url = first_attachment.get("target", {}).get("url") if first_attachment else None
    if target_url:
        post_url = target_url
    elif from_id:
        # Strip the "pageId_" prefix if present to get the short post id
        short_id = post_id.split("_", 1)[-1] if "_" in post_id else post_id
        post_url = f"https://www.facebook.com/{from_id}/posts/{short_id}"
    else:
        post_url = f"https://www.facebook.com/{post_id}"

    return {
        "post_id": post_id,
        "message": item.get("message"),
        "created_time": _parse_dt(item.get("created_time")),
        "updated_time": _parse_dt(item.get("updated_time")),
        "from_name": from_name,
        "from_id": from_id,
        "comment_count": comment_count,
        "reaction_count": reaction_count,
        "share_count": share_count,
        "attachment_type": attachment_type,
        "attachment_url": attachment_url,
        "post_url": post_url,
        "raw_data": item,
    }


def _unwrap_response(raw: dict) -> tuple[list[dict], dict]:
    """
    Handle the two possible AKNG API response shapes:

    Shape A (wrapped):
        {"success": true, "data": {"data": [...], "paging": {...}}}
    Shape B (direct):
        {"data": [...], "paging": {...}}
    Shape C (wrapped error):
        {"success": true, "data": {"error": {"code": 1, "message": "..."}}}

    Returns (posts_list, paging_dict).
    Raises RuntimeError on nested API errors.
    """
    inner = raw

    # Unwrap Shape A: the outer "data" key contains the real payload
    if "success" in raw and isinstance(raw.get("data"), dict):
        inner = raw["data"]

    # Detect nested error (Shape C) — API returns success:true but data has error
    if "error" in inner and isinstance(inner["error"], dict):
        err = inner["error"]
        raise RuntimeError(
            f"AKNG API error (code {err.get('code')}): {err.get('message')}"
        )

    posts = inner.get("data", [])
    paging = inner.get("paging", {})
    return posts, paging


def _next_cursor(paging: dict) -> str | None:
    """
    Extract the pagination cursor from the AKNG paging object.

    AKNG returns paging.next as a URL containing __paging_token param.
    Falls back to standard Facebook cursors.after format.
    """
    # AKNG format: extract __paging_token from the "next" URL
    next_url = paging.get("next")
    if next_url:
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(next_url).query)
        token = qs.get("__paging_token", [None])[0]
        if token:
            return token

    # Fallback: standard Facebook cursors format
    cursors = paging.get("cursors", {})
    return cursors.get("after")


def _publish_progress(job: ScrapingJob, stage: str = "", stage_data: dict | None = None) -> None:
    """Publish the current job progress snapshot to SSE subscribers."""
    publish_job_progress(str(job.id), {
        "status": job.status,
        "progress_pct": float(job.progress_pct),
        "processed_items": job.processed_items,
        "total_items": job.total_items,
        "failed_items": job.failed_items,
        "result_row_count": job.result_row_count,
        "current_stage": stage,
        "stage_data": stage_data or {},
    })


# ── Celery entry point ──────────────────────────────────────────────


@celery_app.task(bind=True, name="app.scraping.tasks.run_post_discovery_pipeline")
def run_post_discovery_pipeline(self, job_id: str):
    """Celery entry point. Runs the async pipeline in a fresh event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_execute_post_discovery(job_id, self))
    finally:
        loop.close()


# ── Async pipeline ──────────────────────────────────────────────────


async def _execute_post_discovery(job_id: str, celery_task):
    """Execute the 3-stage post-discovery pipeline."""
    client = FacebookGraphClient()
    mapper = FacebookProfileMapper()
    rate_limiter = RateLimiter()

    try:
        async with async_session() as db:
            # ── Load job ────────────────────────────────────────
            result = await db.execute(
                select(ScrapingJob).where(ScrapingJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if not job:
                logger.error(f"Job {job_id} not found")
                return

            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await db.commit()

            await _append_log(db, job, "info", "start", "Post discovery pipeline started")
            _publish_progress(job, "start")

            job_settings = job.settings or {}

            try:
                # ── STAGE 1: Parse Input ────────────────────────
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "parse_input")
                    await _append_log(db, job, "warn", "parse_input", f"Job {current_status} by user")
                    _publish_progress(job, "parse_input")
                    return

                logger.info(f"[Job {job_id}] Stage 1: Parsing page/group input")
                await _append_log(db, job, "info", "parse_input", "Parsing page/group input")

                parsed = client.parse_page_input(job.input_value)
                page_id = parsed["page_id"]
                is_group = parsed["is_group"]

                job.input_metadata = parsed
                await _save_pipeline_state(db, job, "parse_input", page_id=page_id, is_group=is_group)

                logger.info(f"[Job {job_id}] Parsed: page_id={page_id}, is_group={is_group}")
                await _append_log(db, job, "info", "parse_input", f"Parsed: page_id={page_id}, is_group={is_group}")

                # ── STAGE 1.5: Fetch page/author profile ────────
                if page_id:
                    try:
                        logger.info(f"[Job {job_id}] Stage 1.5: Fetching author profile for {page_id}")
                        await _append_log(db, job, "info", "fetch_author", f"Fetching author profile for {page_id}")
                        await rate_limiter.wait_for_slot("akng_api_global", max_requests=settings_rate_limit())
                        # Try multiple token types on 401
                        author_raw = None
                        _author_tokens = ["EAAAAU", "EAAGNO", "EAAD6V"]
                        for _at in _author_tokens:
                            try:
                                author_raw = await client.get_object_details(page_id, token_type=_at)
                                break
                            except httpx.HTTPStatusError as _ae:
                                if _ae.response.status_code == 401:
                                    logger.warning(f"[Job {job_id}] Author fetch 401 with {_at}, trying next...")
                                    continue
                                raise
                        if author_raw is None:
                            raise httpx.HTTPStatusError(
                                "All token types returned 401 for author fetch",
                                request=httpx.Request("GET", f"/{page_id}"),
                                response=httpx.Response(401),
                            )
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

                # ── STAGE 2: Fetch Posts (paginated) ────────────
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "fetch_posts")
                    await _append_log(db, job, "warn", "fetch_posts", f"Job {current_status} by user")
                    _publish_progress(job, "fetch_posts")
                    return

                logger.info(f"[Job {job_id}] Stage 2: Fetching posts for {page_id}")
                await _append_log(db, job, "info", "fetch_posts", f"Fetching posts for {page_id}")

                # Settings
                token_type = job_settings.get("token_type", "EAAAAU")
                max_pages = int(job_settings.get("max_pages", 50))

                # Groups require a different token type
                if is_group:
                    token_type = "EAAGNO"

                # Token types to try on 401 (fallback order)
                _TOKEN_FALLBACKS = ["EAAAAU", "EAAGNO", "EAAD6V"]

                cursor: str | None = None
                pages_fetched = 0
                total_posts_fetched = 0
                duplicate_count = 0
                empty_streak = 0
                pages_with_posts = 0
                first_before_cursor: str | None = None
                seen_post_ids: set[str] = set()

                # Allow continuing from a previous job's cursor
                start_cursor = job_settings.get("start_from_cursor")
                if start_cursor:
                    cursor = start_cursor
                    logger.info(f"[Job {job_id}] Starting from user-selected cursor")
                    await _append_log(db, job, "info", "fetch_posts", "Continuing from previous cursor")

                while pages_fetched < max_pages:
                    # Rate limit before each API call
                    await rate_limiter.wait_for_slot(
                        "akng_api_global",
                        max_requests=settings_rate_limit(),
                    )

                    # Try current token_type first; on 401, cycle through fallbacks
                    raw_response = None
                    tried_types = [token_type] + [t for t in _TOKEN_FALLBACKS if t != token_type]
                    last_err = None
                    for try_token in tried_types:
                        try:
                            raw_response = await client.get_page_feed(
                                page_id,
                                token_type=try_token,
                                limit=10,
                                after=cursor,
                                order="reverse_chronological",
                            )
                            if try_token != token_type:
                                logger.info(f"[Job {job_id}] Token type {token_type} failed, switched to {try_token}")
                                await _append_log(db, job, "info", "fetch_posts",
                                    f"Switched token type from {token_type} to {try_token}")
                                token_type = try_token
                            last_err = None
                            break
                        except httpx.HTTPStatusError as e:
                            if e.response.status_code == 401:
                                last_err = e
                                logger.warning(f"[Job {job_id}] 401 with token_type={try_token}, trying next...")
                                continue
                            raise  # Non-401 errors should propagate immediately
                    if last_err is not None:
                        raise last_err  # All token types failed with 401

                    logger.info(
                        "[Job %s] Raw API response keys: %s, first 500 chars: %s",
                        job_id, list(raw_response.keys()), str(raw_response)[:500],
                    )

                    posts_data, paging = _unwrap_response(raw_response)
                    pages_fetched += 1

                    # Capture the "before" cursor from the first page (for backward/newer pagination)
                    if pages_fetched == 1:
                        first_before_cursor = paging.get("cursors", {}).get("before")

                    # Process each post in this page (skip duplicates)
                    new_posts_this_page = 0
                    for item in posts_data:
                        fields = _extract_post_fields(item)
                        pid = fields["post_id"]
                        if pid in seen_post_ids:
                            duplicate_count += 1
                            continue
                        seen_post_ids.add(pid)

                        scraped_post = ScrapedPost(
                            job_id=job.id,
                            tenant_id=job.tenant_id,
                            post_id=pid,
                            message=fields["message"],
                            created_time=fields["created_time"],
                            updated_time=fields["updated_time"],
                            from_name=fields["from_name"],
                            from_id=fields["from_id"],
                            comment_count=fields["comment_count"],
                            reaction_count=fields["reaction_count"],
                            share_count=fields["share_count"],
                            attachment_type=fields["attachment_type"],
                            attachment_url=fields["attachment_url"],
                            post_url=fields["post_url"],
                            raw_data=fields["raw_data"],
                        )
                        db.add(scraped_post)
                        total_posts_fetched += 1
                        new_posts_this_page += 1

                    # Track consecutive empty pages to stop early
                    if new_posts_this_page > 0:
                        empty_streak = 0
                        pages_with_posts += 1
                    else:
                        empty_streak += 1

                    # Persist pipeline state after each page
                    job.processed_items = total_posts_fetched
                    job.total_items = total_posts_fetched  # grows as we discover
                    job.result_row_count = total_posts_fetched
                    job.progress_pct = round(pages_fetched / max_pages * 100, 2)
                    await _save_pipeline_state(
                        db, job, "fetch_posts",
                        pages_fetched=pages_fetched,
                        last_cursor=cursor,
                        total_posts_fetched=total_posts_fetched,
                    )

                    # Update Celery task state
                    celery_task.update_state(
                        state="PROGRESS",
                        meta={
                            "current": total_posts_fetched,
                            "pages": pages_fetched,
                            "percent": float(job.progress_pct),
                        },
                    )

                    _publish_progress(job, "fetch_posts", {
                        "pages_fetched": pages_fetched,
                        "max_pages": max_pages,
                        "total_posts": total_posts_fetched,
                        "duplicates_skipped": duplicate_count,
                    })

                    # Check for pause/cancel after each page
                    current_status = await _check_job_status(db, job.id)
                    if current_status in ("paused", "cancelled"):
                        job.status = current_status
                        await _save_pipeline_state(
                            db, job, "fetch_posts",
                            pages_fetched=pages_fetched,
                            last_cursor=cursor,
                            total_posts_fetched=total_posts_fetched,
                        )
                        await _append_log(
                            db, job, "warn", "fetch_posts",
                            f"Job {current_status} by user after {pages_fetched} pages ({total_posts_fetched} posts)",
                        )
                        _publish_progress(job, "fetch_posts")
                        return

                    # Stop early if too many consecutive empty pages
                    if empty_streak >= 3:
                        logger.info(
                            f"[Job {job_id}] Stopping early: {empty_streak} consecutive empty pages"
                        )
                        await _append_log(
                            db, job, "info", "fetch_posts",
                            f"Stopped early: {empty_streak} consecutive pages with no new posts",
                        )
                        break

                    # Advance cursor
                    cursor = _next_cursor(paging)
                    if not cursor:
                        break

                logger.info(
                    f"[Job {job_id}] Fetched {total_posts_fetched} posts from {pages_fetched} pages"
                )
                await _append_log(
                    db, job, "info", "fetch_posts",
                    f"Fetched {total_posts_fetched} posts from {pages_fetched} pages",
                )

                # ── STAGE 3: Finalize ───────────────────────────
                current_status = await _check_job_status(db, job.id)
                if current_status in ("paused", "cancelled"):
                    job.status = current_status
                    await _save_pipeline_state(db, job, "finalize")
                    await _append_log(db, job, "warn", "finalize", f"Job {current_status} by user")
                    _publish_progress(job, "finalize")
                    return

                logger.info(f"[Job {job_id}] Stage 3: Finalizing")
                await _append_log(db, job, "info", "finalize", "Finalizing post discovery")

                job.status = "completed"
                job.completed_at = datetime.now(timezone.utc)
                job.result_row_count = total_posts_fetched
                job.progress_pct = 100

                # Credits: charge for productive pages + 1 confirming empty page
                credits_used = min(pages_fetched, max(pages_with_posts + 1, 1))
                job.credits_used = credits_used

                # Debit from CreditBalance and record transaction
                balance_result = await db.execute(
                    select(CreditBalance).where(CreditBalance.tenant_id == job.tenant_id)
                )
                balance = balance_result.scalar_one_or_none()

                if balance:
                    balance.balance -= credits_used
                    balance.lifetime_used += credits_used

                    tx = CreditTransaction(
                        tenant_id=job.tenant_id,
                        user_id=job.user_id,
                        type="usage",
                        amount=-credits_used,
                        balance_after=balance.balance,
                        description=f"Post discovery: {total_posts_fetched} posts from {pages_fetched} pages",
                        reference_type="scraping_job",
                        reference_id=job.id,
                    )
                    db.add(tx)

                await _save_pipeline_state(
                    db, job, "finalize",
                    pages_fetched=pages_fetched,
                    pages_with_posts=pages_with_posts,
                    total_posts_fetched=total_posts_fetched,
                    first_before_cursor=first_before_cursor,
                    last_after_cursor=cursor,
                )

                await _append_log(
                    db, job, "info", "finalize",
                    f"Completed: {total_posts_fetched} posts, {credits_used} credits used",
                )

                _publish_progress(job, "finalize")

                logger.info(
                    f"[Job {job_id}] Completed: {total_posts_fetched} posts, "
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
                logger.exception(f"[Job {job_id}] Post discovery pipeline failed: {e}")
                current_state = (job.error_details or {}).get("pipeline_state", {})
                failed_stage = current_state.get("current_stage", "unknown")
                await _save_error_details(db, job, failed_stage, e)
                await _append_log(
                    db, job, "error", failed_stage,
                    f"Pipeline failed: {type(e).__name__}: {e}",
                )

                _publish_progress(job, failed_stage)

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
