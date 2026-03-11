"""Celery task that monitors a Facebook Live stream for comments in real-time.

Connects to FB's streaming-graph SSE or falls back to polling.
Detects orders, triggers auto-replies, and publishes to Redis for the SSE frontend.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone

import httpx
import redis as sync_redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.config import get_settings
from app.models.fb_ads import FBPage
from app.models.fb_live_sell import LiveComment, LiveSession
from app.models.system import SystemSetting
from app.services.meta_api import GRAPH_API_VERSION, MetaAPIService

logger = logging.getLogger(__name__)

DEFAULT_ORDER_KEYWORDS = ["+1", "order", "nak", "beli", "want", "buy", "pm"]


def _check_order(message: str, keywords: list[str]) -> tuple[bool, list[str]]:
    """Check if a comment message matches order keywords."""
    msg_lower = message.lower().strip()
    matched = []
    for kw in keywords:
        kw_lower = kw.lower().strip()
        if not kw_lower:
            continue
        # For short keywords like "+1", check word boundaries
        if len(kw_lower) <= 2:
            if re.search(rf"(?:^|\s){re.escape(kw_lower)}(?:\s|$)", msg_lower):
                matched.append(kw)
        else:
            if kw_lower in msg_lower:
                matched.append(kw)
    return (len(matched) > 0, matched)


def _render_template(template: str, commenter_name: str) -> str:
    """Substitute variables in a reply template."""
    first_name = commenter_name.split()[0] if commenter_name else ""
    return (
        template
        .replace("{name}", commenter_name or "")
        .replace("{first_name}", first_name)
    )


def _publish_comment(r: sync_redis.Redis, session_id: str, comment_data: dict):
    """Publish a comment event to Redis for SSE streaming."""
    channel = f"live_comments:{session_id}"
    r.publish(channel, json.dumps(comment_data))


async def _async_monitor(session_id: str):
    """Async implementation of the live comment monitor."""
    settings = get_settings()
    engine = create_async_engine(settings.effective_database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    r = sync_redis.from_url(settings.redis_url)
    meta = MetaAPIService()

    try:
        async with async_session() as db:
            # Load session
            result = await db.execute(
                select(LiveSession).where(LiveSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            if not session:
                logger.error(f"[LiveSell] Session {session_id} not found")
                return

            # Load page token
            page_result = await db.execute(
                select(FBPage).where(FBPage.id == session.fb_page_id)
            )
            page = page_result.scalar_one_or_none()
            if not page or not page.access_token_encrypted:
                logger.error(f"[LiveSell] No page token for session {session_id}")
                await db.execute(
                    update(LiveSession)
                    .where(LiveSession.id == session.id)
                    .values(status="stopped", ended_at=datetime.now(timezone.utc))
                )
                await db.commit()
                return

            page_token = meta.decrypt_token(page.access_token_encrypted)
            video_id = session.video_id

            # Load settings
            sess_settings = session.settings or {}
            order_keywords = sess_settings.get("order_keywords", DEFAULT_ORDER_KEYWORDS)
            auto_reply_enabled = sess_settings.get("auto_reply_enabled", False)
            auto_reply_mode = sess_settings.get("auto_reply_mode", "template")
            auto_reply_template = sess_settings.get(
                "auto_reply_template",
                "Hi {name}, thank you for your order! We'll DM you shortly."
            )

        # Try SSE streaming first, fall back to polling
        try:
            await _monitor_via_sse(
                session_id, video_id, page_token,
                order_keywords, auto_reply_enabled, auto_reply_mode,
                auto_reply_template, meta, r, engine, async_session,
            )
        except Exception as sse_err:
            logger.warning(
                f"[LiveSell] SSE failed for session {session_id}, falling back to polling: {sse_err}"
            )
            await _monitor_via_polling(
                session_id, video_id, page_token,
                order_keywords, auto_reply_enabled, auto_reply_mode,
                auto_reply_template, meta, r, engine, async_session,
            )

    except Exception as e:
        logger.exception(f"[LiveSell] Monitor failed for session {session_id}: {e}")
    finally:
        r.close()
        await engine.dispose()


async def _check_session_active(async_session, session_id: str) -> bool:
    """Check if the session is still in monitoring state."""
    async with async_session() as db:
        result = await db.execute(
            select(LiveSession.status).where(LiveSession.id == session_id)
        )
        row = result.one_or_none()
        return row is not None and row[0] == "monitoring"


async def _process_comment(
    db: AsyncSession,
    r: sync_redis.Redis,
    meta: MetaAPIService,
    page_token: str,
    session_id: str,
    fb_comment_id: str,
    commenter_id: str,
    commenter_name: str,
    message: str,
    created_time: str,
    order_keywords: list[str],
    auto_reply_enabled: bool,
    auto_reply_mode: str,
    auto_reply_template: str,
):
    """Process a single comment: store, detect order, auto-reply, publish."""
    # Check for duplicate
    existing = await db.execute(
        select(LiveComment.id).where(LiveComment.fb_comment_id == fb_comment_id)
    )
    if existing.scalar_one_or_none():
        return

    is_order, matched = _check_order(message, order_keywords)

    comment = LiveComment(
        session_id=session_id,
        fb_comment_id=fb_comment_id,
        commenter_id=commenter_id,
        commenter_name=commenter_name,
        message=message,
        is_order=is_order,
        matched_keywords=matched if matched else None,
        created_at=datetime.fromisoformat(created_time.replace("Z", "+00:00"))
        if created_time else datetime.now(timezone.utc),
    )

    # Auto-reply for orders
    reply_msg = None
    if is_order and auto_reply_enabled and auto_reply_mode == "template":
        reply_msg = _render_template(auto_reply_template, commenter_name)
        try:
            await meta.reply_to_comment(page_token, fb_comment_id, reply_msg)
            comment.replied = True
            comment.reply_message = reply_msg
        except Exception as reply_err:
            logger.warning(f"[LiveSell] Auto-reply failed: {reply_err}")

    db.add(comment)

    # Update session stats
    await db.execute(
        update(LiveSession)
        .where(LiveSession.id == session_id)
        .values(
            total_comments=LiveSession.total_comments + 1,
            total_orders=LiveSession.total_orders + (1 if is_order else 0),
        )
    )
    await db.commit()
    await db.refresh(comment)

    # Publish to Redis for SSE
    _publish_comment(r, str(session_id), {
        "event": "new_comment",
        "id": str(comment.id),
        "fb_comment_id": fb_comment_id,
        "commenter_id": commenter_id,
        "commenter_name": commenter_name,
        "message": message,
        "is_order": is_order,
        "matched_keywords": matched,
        "replied": comment.replied,
        "reply_message": reply_msg,
        "created_at": comment.created_at.isoformat(),
    })


async def _monitor_via_sse(
    session_id, video_id, page_token,
    order_keywords, auto_reply_enabled, auto_reply_mode,
    auto_reply_template, meta, r, engine, async_session_factory,
):
    """Monitor comments via Facebook's streaming SSE endpoint."""
    url = (
        f"https://streaming-graph.facebook.com/{GRAPH_API_VERSION}/{video_id}/live_comments"
        f"?access_token={page_token}"
        f"&comment_rate=one_per_two_seconds"
        f"&fields=from{{name,id}},message,created_time"
    )

    check_interval = 0
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                line = line.strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    data_str = line[5:].strip()
                    if not data_str:
                        continue
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    fb_comment_id = data.get("id", "")
                    from_data = data.get("from", {})
                    commenter_id = from_data.get("id", "")
                    commenter_name = from_data.get("name", "Unknown")
                    message = data.get("message", "")
                    created_time = data.get("created_time", "")

                    if fb_comment_id and message:
                        async with async_session_factory() as db:
                            await _process_comment(
                                db, r, meta, page_token, session_id,
                                fb_comment_id, commenter_id, commenter_name,
                                message, created_time,
                                order_keywords, auto_reply_enabled,
                                auto_reply_mode, auto_reply_template,
                            )

                # Periodically check if session is still active
                check_interval += 1
                if check_interval >= 30:
                    check_interval = 0
                    if not await _check_session_active(async_session_factory, session_id):
                        logger.info(f"[LiveSell] Session {session_id} stopped by user")
                        break

    # Mark session as completed/stopped
    async with async_session_factory() as db:
        await db.execute(
            update(LiveSession)
            .where(LiveSession.id == session_id)
            .values(status="completed", ended_at=datetime.now(timezone.utc))
        )
        await db.commit()

    _publish_comment(r, str(session_id), {"event": "session_ended"})


async def _monitor_via_polling(
    session_id, video_id, page_token,
    order_keywords, auto_reply_enabled, auto_reply_mode,
    auto_reply_template, meta, r, engine, async_session_factory,
):
    """Fallback: poll comments every 3 seconds using Graph API."""
    last_timestamp = None
    max_retries = 5
    retry_count = 0

    while True:
        # Check if session still active
        if not await _check_session_active(async_session_factory, session_id):
            logger.info(f"[LiveSell] Session {session_id} stopped by user (polling)")
            break

        try:
            result = await meta.get_video_comments(
                page_token, video_id, since=last_timestamp, limit=50
            )
            comments_data = result.get("data", [])
            retry_count = 0  # Reset on success

            for c in reversed(comments_data):  # Process oldest first
                fb_comment_id = c.get("id", "")
                from_data = c.get("from", {})
                commenter_id = from_data.get("id", "")
                commenter_name = from_data.get("name", "Unknown")
                message = c.get("message", "")
                created_time = c.get("created_time", "")

                if fb_comment_id and message:
                    async with async_session_factory() as db:
                        await _process_comment(
                            db, r, meta, page_token, session_id,
                            fb_comment_id, commenter_id, commenter_name,
                            message, created_time,
                            order_keywords, auto_reply_enabled,
                            auto_reply_mode, auto_reply_template,
                        )
                    # Update timestamp for next poll
                    if created_time:
                        last_timestamp = created_time

        except Exception as e:
            retry_count += 1
            logger.warning(
                f"[LiveSell] Poll failed for session {session_id} "
                f"(retry {retry_count}/{max_retries}): {e}"
            )
            if retry_count >= max_retries:
                logger.error(f"[LiveSell] Max retries reached for session {session_id}")
                break

        await asyncio.sleep(3)

    # Mark session ended
    async with async_session_factory() as db:
        await db.execute(
            update(LiveSession)
            .where(LiveSession.id == session_id)
            .values(status="completed", ended_at=datetime.now(timezone.utc))
        )
        await db.commit()

    _publish_comment(r, str(session_id), {"event": "session_ended"})


@celery_app.task(
    name="app.services.live_sell_tasks.monitor_live_session",
    bind=True,
    max_retries=0,
)
def monitor_live_session(self, session_id: str):
    """Celery task wrapper — runs the async monitor loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_async_monitor(session_id))
    finally:
        loop.close()
