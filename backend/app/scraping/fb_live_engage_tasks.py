"""Celery task for livestream engagement — monitor comments + post AI-generated comments."""

import asyncio
import json
import logging
import random
import uuid
from datetime import datetime, timezone

from app.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(name="app.scraping.fb_live_engage_tasks.run_live_engagement", bind=True)
def run_live_engagement(self, session_id: str):
    """Long-running Celery task: monitor + engage on a livestream."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_execute_engagement(session_id))
    finally:
        loop.close()


async def _execute_engagement(session_id: str):
    """Main async entry — two concurrent coroutines: monitor + engage."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    from app.models.fb_live_engage import FBLiveEngageSession
    from app.models.fb_login_result import FBLoginResult
    from app.scraping.clients.facebook import FacebookGraphClient
    from app.services.meta_api import MetaAPIService

    engine = create_async_engine(settings.async_database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    meta = MetaAPIService()

    try:
        # ── Load session ─────────────────────────────────────
        async with SessionLocal() as db:
            result = await db.execute(
                select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
            )
            session = result.scalar_one_or_none()
            if not session:
                logger.error(f"[LiveEngage] Session {session_id} not found")
                return

            session.status = "running"
            session.started_at = datetime.now(timezone.utc)
            await db.commit()

            # Capture config before leaving db context
            config = {
                "post_id": session.post_id,
                "role_distribution": session.role_distribution or {},
                "business_context": session.business_context or "",
                "training_comments": session.training_comments,
                "ai_instructions": session.ai_instructions or "",
                "min_delay": session.min_delay_seconds,
                "max_delay": session.max_delay_seconds,
                "login_batch_id": session.login_batch_id,
                "tenant_id": session.tenant_id,
                "user_id": session.user_id,
            }

        # ── Load accounts from login batch ───────────────────
        async with SessionLocal() as db:
            result = await db.execute(
                select(FBLoginResult).where(
                    FBLoginResult.login_batch_id == config["login_batch_id"],
                    FBLoginResult.status == "success",
                )
            )
            login_results = result.scalars().all()

        if not login_results:
            async with SessionLocal() as db:
                result = await db.execute(
                    select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                )
                s = result.scalar_one()
                s.status = "failed"
                s.error_message = "No successful login accounts found in the selected batch"
                s.ended_at = datetime.now(timezone.utc)
                await db.commit()
            return

        # Decrypt cookies and build account pool
        account_pool = []
        for lr in login_results:
            try:
                cookie = meta.decrypt_token(lr.cookie_encrypted) if lr.cookie_encrypted else ""
                proxy = None
                if lr.proxy_used and isinstance(lr.proxy_used, dict) and lr.proxy_used.get("host"):
                    proxy = lr.proxy_used
                account_pool.append({
                    "email": lr.email,
                    "cookie": cookie,
                    "user_agent": lr.user_agent or "",
                    "proxy": proxy,
                })
            except Exception as exc:
                logger.warning(f"[LiveEngage] Failed to decrypt cookie for {lr.email}: {exc}")

        if not account_pool:
            async with SessionLocal() as db:
                result = await db.execute(
                    select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                )
                s = result.scalar_one()
                s.status = "failed"
                s.error_message = "Failed to decrypt any account cookies"
                s.ended_at = datetime.now(timezone.utc)
                await db.commit()
            return

        random.shuffle(account_pool)

        # Update active accounts count
        async with SessionLocal() as db:
            result = await db.execute(
                select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
            )
            s = result.scalar_one()
            s.active_accounts = len(account_pool)
            await db.commit()

        logger.info(f"[LiveEngage] Session {session_id} starting with {len(account_pool)} accounts on post {config['post_id']}")

        # ── Shared state ─────────────────────────────────────
        recent_comments: list[dict] = []
        seen_comment_ids: set[str] = set()
        our_content: set[str] = set()
        stop_event = asyncio.Event()

        client = FacebookGraphClient()

        # ── Run both loops concurrently ──────────────────────
        try:
            await asyncio.gather(
                _monitor_loop(
                    client, config["post_id"], recent_comments, seen_comment_ids,
                    our_content, stop_event, session_id, SessionLocal,
                ),
                _engage_loop(
                    client, config["post_id"], recent_comments, our_content,
                    stop_event, account_pool, config, session_id, SessionLocal,
                ),
            )
        finally:
            await client.close()

        # ── Finalize ─────────────────────────────────────────
        async with SessionLocal() as db:
            result = await db.execute(
                select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
            )
            s = result.scalar_one_or_none()
            if s and s.status == "running":
                s.status = "completed"
            if s:
                s.ended_at = datetime.now(timezone.utc)
            await db.commit()

    except Exception as exc:
        logger.exception(f"[LiveEngage] Session {session_id} crashed: {exc}")
        try:
            async with SessionLocal() as db:
                result = await db.execute(
                    select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                )
                s = result.scalar_one_or_none()
                if s and s.status == "running":
                    s.status = "failed"
                    s.error_message = str(exc)[:500]
                    s.ended_at = datetime.now(timezone.utc)
                    await db.commit()
        except Exception:
            pass
    finally:
        await engine.dispose()


async def _monitor_loop(
    client, post_id, recent_comments, seen_comment_ids, our_content,
    stop_event, session_id, SessionLocal,
):
    """Poll comments via AKNG scrape API with cursor tracking.

    Uses ``get_post_comments`` (no Facebook account needed — pure AKNG scrape).
    Tracks the ``after`` cursor so each poll only fetches NEW comments since the
    last successful fetch, avoiding re-scraping from the beginning every time.
    """
    from sqlalchemy import select
    from app.models.fb_live_engage import FBLiveEngageSession

    iteration = 0
    after_cursor: str | None = None  # Track pagination cursor for incremental fetching

    while not stop_event.is_set():
        try:
            # Check session status every ~30s (every 4th iteration)
            iteration += 1
            if iteration % 4 == 0:
                try:
                    async with SessionLocal() as db:
                        result = await db.execute(
                            select(FBLiveEngageSession.status).where(
                                FBLiveEngageSession.id == uuid.UUID(session_id)
                            )
                        )
                        status = result.scalar_one_or_none()
                        if status and status != "running":
                            logger.info(f"[LiveEngage] Monitor: session {session_id} status={status}, stopping")
                            stop_event.set()
                            break
                except Exception as exc:
                    logger.warning(f"[LiveEngage] Monitor: DB check failed: {exc}")

            # Fetch comments via AKNG scrape API (no FB account needed)
            # Use cursor to only fetch new comments since last poll
            try:
                response = await client.get_post_comments(
                    post_id, limit=50, comment_filter="stream",
                    after=after_cursor,
                )
            except Exception as exc:
                logger.warning(f"[LiveEngage] Monitor: fetch failed: {exc}")
                await asyncio.sleep(8)
                continue

            # Parse AKNG response — unwrap wrapper
            comments_data = []
            next_cursor = None
            if isinstance(response, dict):
                # AKNG wraps: {success, data: {comments: {data: [...], paging: {...}}}}
                data = response.get("data", response)
                if isinstance(data, dict):
                    comments_obj = data.get("comments", data)
                    if isinstance(comments_obj, dict):
                        comments_data = comments_obj.get("data", [])
                        # Extract next cursor for incremental polling
                        paging = comments_obj.get("paging", {})
                        cursors = paging.get("cursors", {})
                        next_cursor = cursors.get("after")
                    elif isinstance(comments_obj, list):
                        comments_data = comments_obj

            new_count = 0
            for c in comments_data:
                if not isinstance(c, dict):
                    continue
                cid = c.get("id", "")
                message = c.get("message", "")
                if not cid or not message:
                    continue
                if cid in seen_comment_ids:
                    continue
                # Skip our own comments
                if message in our_content:
                    seen_comment_ids.add(cid)
                    continue

                seen_comment_ids.add(cid)
                from_data = c.get("from", {})
                recent_comments.append({
                    "id": cid,
                    "from_name": from_data.get("name", ""),
                    "from_id": from_data.get("id", ""),
                    "message": message,
                    "created_time": c.get("created_time", ""),
                })
                new_count += 1

            # Advance cursor only when we got results (avoids losing position on empty polls)
            if next_cursor and comments_data:
                after_cursor = next_cursor

            # Trim to last 50
            if len(recent_comments) > 50:
                recent_comments[:] = recent_comments[-50:]

            # Update monitored count
            if new_count > 0:
                try:
                    async with SessionLocal() as db:
                        result = await db.execute(
                            select(FBLiveEngageSession).where(
                                FBLiveEngageSession.id == uuid.UUID(session_id)
                            )
                        )
                        s = result.scalar_one()
                        s.comments_monitored += new_count
                        await db.commit()
                except Exception:
                    pass

        except Exception as exc:
            logger.warning(f"[LiveEngage] Monitor: unexpected error: {exc}")

        await asyncio.sleep(8)


async def _engage_loop(
    client, post_id, recent_comments, our_content,
    stop_event, account_pool, config, session_id, SessionLocal,
):
    """Generate and post AI comments at random intervals."""
    from sqlalchemy import select
    from app.models.fb_live_engage import FBLiveEngageSession, FBLiveEngageLog
    from app.services.ai_live_engage import AILiveEngageService

    ai_service = AILiveEngageService()
    account_idx = 0

    # Build role weights for random.choices
    role_dist = config["role_distribution"]
    roles = list(role_dist.keys())
    weights = [role_dist[r] for r in roles]

    while not stop_event.is_set():
        try:
            # Warm-up: wait until we have some real comments for context
            if len(recent_comments) < 3:
                await asyncio.sleep(5)
                continue

            # Pick role via weighted random
            role = random.choices(roles, weights=weights, k=1)[0]

            # Pick account (round-robin)
            account = account_pool[account_idx % len(account_pool)]
            account_idx += 1

            # Generate comment
            reference_comment = None
            try:
                if role in ("react_comment", "repeat_question") and recent_comments:
                    # Pick a random recent comment as reference
                    ref = random.choice(recent_comments[-10:]) if len(recent_comments) >= 3 else recent_comments[-1]
                    reference_comment = f"{ref.get('from_name', '')}: {ref.get('message', '')}"

                content = await ai_service.generate_comment(
                    role=role,
                    recent_comments=recent_comments,
                    business_context=config["business_context"],
                    training_comments=config["training_comments"],
                    ai_instructions=config["ai_instructions"],
                )
            except Exception as exc:
                logger.warning(f"[LiveEngage] AI generation error: {exc}")
                content = None

            if not content:
                await asyncio.sleep(5)
                continue

            # Track our content so monitor can skip it
            our_content.add(content)

            # Execute via AKNG
            try:
                resp = await client.execute_action(
                    cookie=account["cookie"],
                    user_agent=account["user_agent"],
                    action_name="comment_to_post",
                    params={"post_id": post_id, "content": content},
                    proxy=account.get("proxy"),
                )
            except Exception as exc:
                resp = {"success": False, "error": str(exc)}

            # Parse response
            success, error_msg = _parse_response(resp)

            # Log action
            try:
                async with SessionLocal() as db:
                    log = FBLiveEngageLog(
                        session_id=uuid.UUID(session_id),
                        role=role,
                        content=content,
                        account_email=account["email"],
                        reference_comment=reference_comment,
                        status="success" if success else "failed",
                        error_message=error_msg,
                        response_data=resp if isinstance(resp, dict) else None,
                    )
                    db.add(log)

                    # Update session stats
                    result = await db.execute(
                        select(FBLiveEngageSession).where(
                            FBLiveEngageSession.id == uuid.UUID(session_id)
                        )
                    )
                    s = result.scalar_one()
                    if success:
                        s.total_comments_posted += 1
                        by_role = dict(s.comments_by_role or {})
                        by_role[role] = by_role.get(role, 0) + 1
                        s.comments_by_role = by_role
                    else:
                        s.total_errors += 1
                    await db.commit()
            except Exception as exc:
                logger.warning(f"[LiveEngage] Failed to log action: {exc}")

            if success:
                logger.info(f"[LiveEngage] Posted {role} comment via {account['email'][:20]}...")
            else:
                logger.warning(f"[LiveEngage] Failed {role} via {account['email'][:20]}: {error_msg}")

        except Exception as exc:
            logger.warning(f"[LiveEngage] Engage loop error: {exc}")

        # Random delay
        delay = random.uniform(config["min_delay"], config["max_delay"])
        await asyncio.sleep(delay)


def _parse_response(resp: dict) -> tuple[bool, str | None]:
    """Parse AKNG response to determine success and extract error message."""
    if not isinstance(resp, dict):
        return False, "Invalid response"
    success = resp.get("success", False)
    data = resp.get("data", {})
    status_code = None
    status_msg = None
    if isinstance(data, dict):
        status_info = data.get("status", {})
        if isinstance(status_info, dict):
            status_code = status_info.get("code")
            status_msg = status_info.get("message")
    is_success = success and status_code == 1
    error = None if is_success else (status_msg or resp.get("message", "Unknown error"))
    return is_success, error
