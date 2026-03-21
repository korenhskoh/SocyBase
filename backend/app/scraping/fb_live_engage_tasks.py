"""Celery task for livestream engagement — monitor comments + post AI-generated comments."""

import asyncio
import logging
import random
import re
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from time import monotonic

from app.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Regex: 1-3 letters followed by 2-5 digits, optionally +N quantity
# Matches: m763, E769, R2000, G1024, g1024 +1, AB123 +2
# Product code: 1-3 letters + 1-5 digits (L6, L205, AB12, R2000)
# Optionally followed by +N quantity (+1, +2, +3)
PRODUCT_CODE_RE = re.compile(
    r'\b([a-zA-Z]{1,3}\d{1,5})\b'
    r'(?:\s*[+＋]\s*(\d{1,3}))?'
)

# Code format presets for frequency-based detection
CODE_FORMAT_PATTERNS = {
    "numbers": re.compile(r'^\d{1,5}$'),            # 1, 8, 480, 12345
    "letters_numbers": re.compile(r'^[a-zA-Z]{1,3}\d{1,5}$'),  # L6, E204, AB12
    "any_alphanumeric": re.compile(r'^[a-zA-Z0-9]{1,6}$'),     # L6, 480, E204, ABC
    "any_short": None,                                # anything ≤6 chars (broadest)
}


@dataclass
class AdaptiveState:
    """Shared mutable state for adaptive behavior between monitor and engage loops."""
    detected_codes: list = field(default_factory=list)
    comment_timestamps: deque = field(default_factory=lambda: deque(maxlen=200))
    code_comment_timestamps: deque = field(default_factory=lambda: deque(maxlen=200))
    velocity_cpm: float = 0.0
    code_ratio: float = 0.0
    last_recalc: float = 0.0
    code_re: re.Pattern = field(default_factory=lambda: PRODUCT_CODE_RE)
    quantity_variation: bool = True
    aggressive_level: str = "medium"
    code_whitelist: set = field(default_factory=set)  # user-defined codes for whitelist matching
    # Auto-order trending: track recent code mentions for auto place_order
    recent_code_mentions: dict = field(default_factory=dict)  # code → [timestamps]
    last_auto_order_time: float = 0.0  # monotonic timestamp of last auto-order


def _extract_product_codes(message: str, code_re: re.Pattern | None = None) -> list[str]:
    """Extract product code patterns from a comment message."""
    pattern = code_re or PRODUCT_CODE_RE
    matches = pattern.findall(message)
    # findall returns tuples when there are groups; grab the first group (the code itself)
    if matches and isinstance(matches[0], tuple):
        return [m[0] for m in matches]
    return list(matches)


def _recalculate_adaptive(adaptive: AdaptiveState, window_seconds: int = 60):
    """Recalculate velocity and code ratio from recent timestamps."""
    now = monotonic()
    cutoff = now - window_seconds
    recent_all = sum(1 for t in adaptive.comment_timestamps if t > cutoff)
    recent_codes = sum(1 for t in adaptive.code_comment_timestamps if t > cutoff)
    adaptive.velocity_cpm = (recent_all / window_seconds) * 60 if window_seconds > 0 else 0
    adaptive.code_ratio = (recent_codes / recent_all) if recent_all > 0 else 0.0
    adaptive.last_recalc = now


@celery_app.task(
    name="app.scraping.fb_live_engage_tasks.run_live_engagement",
    bind=True,
    max_retries=0,  # never auto-retry — prevents phantom restarts
    acks_late=False,
)
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

    async def _notify_telegram(session_obj, event: str, details: str = ""):
        """Send Telegram notification if user has linked Telegram."""
        try:
            from app.services.telegram_notify import send_live_engage_notification, get_telegram_notification_chat_id
            chat_id = await get_telegram_notification_chat_id()
            if chat_id:
                await send_live_engage_notification(chat_id, session_obj, event, details)
        except Exception:
            pass

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

            # Guard: only start if session is in a valid starting state
            if session.status in ("completed", "stopped", "failed"):
                logger.warning(
                    f"[LiveEngage] Session {session_id} already {session.status}, "
                    f"skipping (possible Celery redelivery)"
                )
                return

            session.status = "running"
            session.started_at = datetime.now(timezone.utc)
            await db.commit()

            # Capture config before leaving db context
            # Derive page owner ID: explicit > extracted from post_id ({page_id}_{post_id})
            page_owner_id = session.page_owner_id or ""
            if not page_owner_id and "_" in session.post_id:
                page_owner_id = session.post_id.split("_")[0]

            config = {
                "post_id": session.post_id,
                "role_distribution": session.role_distribution or {},
                "business_context": session.business_context or "",
                "training_comments": session.training_comments,
                "ai_instructions": session.ai_instructions or "",
                "scrape_interval": session.scrape_interval_seconds or 8,
                "context_window": session.context_window or 50,
                "min_delay": session.min_delay_seconds or 15,
                "max_delay": session.max_delay_seconds or 60,
                "max_duration_minutes": session.max_duration_minutes or 180,
                "page_owner_id": page_owner_id,
                "login_batch_id": session.login_batch_id,
                "tenant_id": session.tenant_id,
                "user_id": session.user_id,
                "product_codes": session.product_codes or "",
                "code_pattern": session.code_pattern or "",
                "quantity_variation": session.quantity_variation if session.quantity_variation is not None else True,
                "aggressive_level": session.aggressive_level or "medium",
                "direct_accounts_encrypted": session.direct_accounts_encrypted or "",
                "target_comments_enabled": bool(session.target_comments_enabled),
                "target_comments_count": session.target_comments_count or 0,
                "target_comments_period_minutes": session.target_comments_period_minutes or 60,
                "languages": session.languages or "",
                "comment_without_new": bool(session.comment_without_new),
                "comment_without_new_max": session.comment_without_new_max or 3,
                "auto_order_trending": bool(session.auto_order_trending),
                "auto_order_trending_threshold": session.auto_order_trending_threshold or 3,
                "auto_order_trending_cooldown": session.auto_order_trending_cooldown or 60,
                "blacklist_words": session.blacklist_words or "",
                "stream_end_threshold": session.stream_end_threshold if session.stream_end_threshold is not None else 0,
                "title": session.title or "",
            }

        # ── Load accounts ─────────────────────────────────────
        account_pool = []

        if config["direct_accounts_encrypted"]:
            # Source 1: Direct accounts from CSV upload
            try:
                import json as _json
                decrypted = meta.decrypt_token(config["direct_accounts_encrypted"])
                direct_accounts = _json.loads(decrypted)
                for acct in direct_accounts:
                    proxy = None
                    if acct.get("proxy_host"):
                        proxy = {
                            "host": acct["proxy_host"],
                            "port": acct.get("proxy_port", ""),
                            "username": acct.get("proxy_username", ""),
                            "password": acct.get("proxy_password", ""),
                        }
                    account_pool.append({
                        "email": acct.get("email", ""),
                        "cookie": acct.get("cookies", ""),
                        "token": acct.get("token", ""),
                        "user_agent": acct.get("user_agent", ""),
                        "proxy": proxy,
                    })
            except Exception as exc:
                logger.warning(f"[LiveEngage] Failed to load direct accounts: {exc}")

        if not account_pool and config.get("login_batch_id"):
            # Source 2: Login batch accounts (fallback)
            async with SessionLocal() as db:
                result = await db.execute(
                    select(FBLoginResult).where(
                        FBLoginResult.login_batch_id == config["login_batch_id"],
                        FBLoginResult.status == "success",
                    )
                )
                login_results = result.scalars().all()

            for lr in login_results:
                try:
                    cookie = meta.decrypt_token(lr.cookie_encrypted) if lr.cookie_encrypted else ""
                    proxy = None
                    if lr.proxy_used and isinstance(lr.proxy_used, dict) and lr.proxy_used.get("host"):
                        proxy = lr.proxy_used
                    token = meta.decrypt_token(lr.access_token_encrypted) if lr.access_token_encrypted else ""
                    # Skip accounts with neither cookie nor token — they can't post
                    if not cookie and not token:
                        logger.warning(f"[LiveEngage] Skipping {lr.email}: no cookie and no token")
                        continue
                    account_pool.append({
                        "email": lr.email,
                        "cookie": cookie,
                        "token": token,
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
                s.error_message = "No accounts available — provide direct accounts or a login batch with successful logins"
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

        # Notify Telegram on start
        class _SessionStub:
            def __init__(self, sid, title, post_id, total=0, errors=0, monitored=0):
                self.id = sid; self.title = title; self.post_id = post_id
                self.total_comments_posted = total; self.total_errors = errors; self.comments_monitored = monitored
        await _notify_telegram(
            _SessionStub(session_id, config.get("title", ""), config["post_id"]),
            "started", f"\n<b>Accounts:</b> {len(account_pool)}"
        )

        # ── Shared state ─────────────────────────────────────
        recent_comments: list[dict] = []
        seen_comment_ids: set[str] = set()
        our_content: set[str] = set()
        stop_event = asyncio.Event()
        new_comments_event = asyncio.Event()  # Signalled when fresh comments arrive
        last_seen_count = [0]  # Mutable counter for engage loop to track what it has processed
        adaptive = AdaptiveState(
            quantity_variation=config.get("quantity_variation", True),
            aggressive_level=config.get("aggressive_level", "medium"),
        )

        # Code pattern field: supports 3 modes
        #   1. Format preset name: "numbers", "letters_numbers", "any_alphanumeric", "any_short"
        #   2. Comma-separated codes: "1,23,E204" → added to whitelist
        #   3. Regex pattern: "[A-Z]\d{3}" → compiled for auto-detection
        custom_pattern = config.get("code_pattern", "") or ""
        if custom_pattern:
            # Check if it's a format preset name
            if custom_pattern.strip().lower() in CODE_FORMAT_PATTERNS:
                config["code_format"] = custom_pattern.strip().lower()
                logger.info(f"[LiveEngage] Code format preset: {config['code_format']}")
            elif bool(re.search(r'[\\()\[\]{}|^$*+?.!]', custom_pattern)):
                # Has regex special chars → compile as regex
                try:
                    adaptive.code_re = re.compile(custom_pattern)
                    logger.info(f"[LiveEngage] Using custom code regex: {custom_pattern}")
                except re.error as e:
                    logger.warning(f"[LiveEngage] Invalid code_pattern '{custom_pattern}': {e}, using default")
            else:
                # Plain text → treat as comma-separated whitelist codes
                logger.info(f"[LiveEngage] Code pattern treated as whitelist codes")

        # Seed product codes — used as whitelist for instant matching
        seed_codes_str = config.get("product_codes", "") or ""
        # Merge seed codes + code_pattern codes (if plain text) into one whitelist
        all_seed_codes: list[str] = []
        if seed_codes_str:
            all_seed_codes.extend(c.strip() for c in seed_codes_str.split(",") if c.strip())
        if custom_pattern and custom_pattern.strip().lower() not in CODE_FORMAT_PATTERNS:
            if not bool(re.search(r'[\\()\[\]{}|^$*+?.!]', custom_pattern)):
                all_seed_codes.extend(c.strip() for c in custom_pattern.split(",") if c.strip())
        # Deduplicate
        seen_codes: set[str] = set()
        unique_codes: list[str] = []
        for c in all_seed_codes:
            if c.upper() not in seen_codes:
                seen_codes.add(c.upper())
                unique_codes.append(c)
        if unique_codes:
            adaptive.detected_codes = unique_codes
            adaptive.code_whitelist = {c.upper() for c in unique_codes}
            logger.info(f"[LiveEngage] Code whitelist: {unique_codes}")

        # Auto-detect code_format from seed codes if not explicitly set
        if "code_format" not in config and unique_codes:
            all_numeric = all(c.isdigit() for c in unique_codes)
            all_alpha_num = all(re.match(r'^[a-zA-Z]{1,3}\d{1,5}$', c) for c in unique_codes)
            if all_numeric:
                config["code_format"] = "numbers"
            elif all_alpha_num:
                config["code_format"] = "letters_numbers"
            else:
                config["code_format"] = "any_alphanumeric"
            logger.info(f"[LiveEngage] Auto-detected code format: {config['code_format']} from seeds")

        client = FacebookGraphClient()

        # ── Run both loops concurrently ──────────────────────
        try:
            await asyncio.gather(
                _monitor_loop(
                    client, config, recent_comments, seen_comment_ids,
                    our_content, stop_event, new_comments_event,
                    session_id, SessionLocal, adaptive,
                ),
                _engage_loop(
                    client, config, recent_comments, our_content,
                    stop_event, new_comments_event, last_seen_count,
                    account_pool, session_id, SessionLocal, adaptive,
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
            if s and s.status in ("running", "paused"):
                s.status = "completed"
                logger.info(f"[LiveEngage] Session {session_id} finalized as completed "
                            f"(posted={s.total_comments_posted}, errors={s.total_errors}, "
                            f"monitored={s.comments_monitored}, accounts={s.active_accounts})")
            if s:
                s.ended_at = datetime.now(timezone.utc)
            await db.commit()
            if s:
                await _notify_telegram(s, s.status or "completed")

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
    client, config, recent_comments, seen_comment_ids, our_content,
    stop_event, new_comments_event, session_id, SessionLocal, adaptive,
):
    """Poll comments via AKNG scrape API at configurable interval.

    Uses ``get_post_comments`` (no Facebook account needed — pure AKNG scrape).
    Tracks the ``after`` cursor so each poll only fetches NEW comments.
    Filters out page owner comments. Signals ``new_comments_event`` when
    fresh viewer comments arrive so the engage loop knows when to act.
    """
    from sqlalchemy import select
    from app.models.fb_live_engage import FBLiveEngageSession

    post_id = config["post_id"]
    page_owner_id = config.get("page_owner_id", "")
    consecutive_empty_polls = 0
    iteration = 0
    after_cursor: str | None = None

    # ── Skip to live edge: paginate through old comments quickly ──
    # Max 20 pages (1000 comments) to avoid getting stuck on huge posts.
    # After that, start polling from wherever we are — new comments will
    # still be detected since they won't be in seen_comment_ids.
    max_skip_pages = 20
    logger.info(f"[LiveEngage] Monitor: skipping to live edge for post {post_id} (max {max_skip_pages} pages)")
    skip_pages = 0
    while not stop_event.is_set() and skip_pages < max_skip_pages:
        try:
            resp = await client.get_post_comments(
                post_id, limit=50, comment_filter="stream", after=after_cursor,
            )
            cdata, ncursor = [], None
            if isinstance(resp, dict):
                d = resp.get("data", resp)
                if isinstance(d, dict):
                    co = d.get("comments", d)
                    if isinstance(co, dict):
                        cdata = co.get("data", [])
                        ncursor = co.get("paging", {}).get("cursors", {}).get("after")
                    elif isinstance(co, list):
                        cdata = co

            for c in cdata:
                cid = c.get("id", "")
                if cid:
                    seen_comment_ids.add(cid)
                msg = c.get("message", "").strip()
                from_data = c.get("from", {})
                if msg and cid:
                    recent_comments.append({
                        "id": cid,
                        "from_name": from_data.get("name", ""),
                        "from_id": from_data.get("id", ""),
                        "message": msg,
                        "created_time": c.get("created_time", ""),
                    })

            skip_pages += 1
            if not ncursor or not cdata:
                break
            after_cursor = ncursor
        except Exception as exc:
            logger.warning(f"[LiveEngage] Monitor: skip-to-edge failed: {exc}")
            break

    ctx_window = config.get("context_window", 50)
    initial_ctx = min(15, ctx_window)
    if len(recent_comments) > initial_ctx:
        recent_comments[:] = recent_comments[-initial_ctx:]

    total_skipped = len(seen_comment_ids)
    logger.info(f"[LiveEngage] Monitor: skipped {total_skipped} old comments ({skip_pages} pages), at live edge now")

    while not stop_event.is_set():
        try:
            # Check session status periodically (~30s)
            iteration += 1
            status_check_every = max(2, int(30 / config["scrape_interval"]))
            if iteration % status_check_every == 0:
                try:
                    async with SessionLocal() as db:
                        result = await db.execute(
                            select(FBLiveEngageSession.status).where(
                                FBLiveEngageSession.id == uuid.UUID(session_id)
                            )
                        )
                        status = result.scalar_one_or_none()
                        if status and status not in ("running", "paused"):
                            logger.info(f"[LiveEngage] Monitor: session {session_id} status={status}, stopping")
                            stop_event.set()
                            break
                except Exception as exc:
                    logger.warning(f"[LiveEngage] Monitor: DB check failed: {exc}")

            # Fetch comments via AKNG scrape API
            try:
                response = await client.get_post_comments(
                    post_id, limit=50, comment_filter="stream",
                    after=after_cursor,
                )
            except Exception as exc:
                logger.warning(f"[LiveEngage] Monitor: fetch failed: {exc}")
                await asyncio.sleep(config["scrape_interval"])
                continue

            # Parse AKNG response — unwrap wrapper
            comments_data = []
            next_cursor = None
            if isinstance(response, dict):
                data = response.get("data", response)
                if isinstance(data, dict):
                    comments_obj = data.get("comments", data)
                    if isinstance(comments_obj, dict):
                        comments_data = comments_obj.get("data", [])
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

                from_data = c.get("from", {})
                from_id = from_data.get("id", "")

                # Skip page owner (livestream host) comments
                if page_owner_id and from_id == page_owner_id:
                    seen_comment_ids.add(cid)
                    continue

                # Skip our own comments (normalize for Facebook text changes)
                msg_normalized = message.strip().lower()
                is_ours = any(
                    msg_normalized == oc.strip().lower() or
                    (len(msg_normalized) > 5 and SequenceMatcher(None, msg_normalized, oc.strip().lower()).ratio() > 0.85)
                    for oc in our_content
                )
                if is_ours:
                    seen_comment_ids.add(cid)
                    continue

                seen_comment_ids.add(cid)
                recent_comments.append({
                    "id": cid,
                    "from_name": from_data.get("name", ""),
                    "from_id": from_id,
                    "message": message,
                    "created_time": c.get("created_time", ""),
                })
                new_count += 1

                # ── Product code detection (3 methods) ──
                now_ts = monotonic()
                adaptive.comment_timestamps.append(now_ts)

                # Method 1: Regex-based detection (L6, m763, E204)
                codes_in_msg = _extract_product_codes(message, adaptive.code_re)

                # Method 2: Whitelist matching — user-defined seed codes
                if adaptive.code_whitelist:
                    msg_upper = message.upper().strip()
                    tokens = set(re.split(r'[\s,+＋]+', msg_upper))
                    for wl_code in adaptive.code_whitelist:
                        if wl_code in tokens or msg_upper == wl_code:
                            if wl_code not in {c.upper() for c in codes_in_msg}:
                                original = wl_code
                                for dc in adaptive.detected_codes:
                                    if dc.upper() == wl_code:
                                        original = dc
                                        break
                                codes_in_msg.append(original)

                # Method 3: Frequency-based auto-detection for short messages
                # Uses code_format to filter what looks like a code
                msg_stripped = message.strip()
                if len(msg_stripped) <= 10 and not codes_in_msg:
                    # Extract the core token (strip +N quantity, order keywords)
                    core = re.sub(r'\s*[+＋]\s*\d{1,3}$', '', msg_stripped).strip()
                    core = re.sub(r'\s+(nak|want|order|beli|pm|要|買)$', '', core, flags=re.IGNORECASE).strip()
                    if core and len(core) <= 6:
                        # Check if core matches the expected code format
                        code_format = config.get("code_format", "any_alphanumeric")
                        format_re = CODE_FORMAT_PATTERNS.get(code_format)
                        looks_like_code = True
                        if format_re is not None:
                            looks_like_code = bool(format_re.match(core))
                        else:
                            # "any_short" — accept anything ≤6 chars
                            looks_like_code = len(core) <= 6

                        if looks_like_code:
                            core_upper = core.upper()
                            if not hasattr(adaptive, '_short_msg_freq'):
                                adaptive._short_msg_freq = {}
                            freq = adaptive._short_msg_freq.setdefault(core_upper, {"count": 0, "viewers": set()})
                            freq["count"] += 1
                            freq["viewers"].add(from_id)
                            # 2+ different viewers → likely a product code
                            if len(freq["viewers"]) >= 2 and core_upper not in {c.upper() for c in codes_in_msg}:
                                codes_in_msg.append(core)
                                logger.info(f"[LiveEngage] Auto-detected code by frequency: '{core}' ({freq['count']} times, {len(freq['viewers'])} viewers)")

                if codes_in_msg:
                    adaptive.code_comment_timestamps.append(now_ts)
                    known_upper = {c.upper() for c in adaptive.detected_codes}
                    for code in codes_in_msg:
                        if code.upper() not in known_upper:
                            adaptive.detected_codes.append(code)
                            known_upper.add(code.upper())
                        # Track recent mentions for trending detection
                        code_key = code.upper()
                        if code_key not in adaptive.recent_code_mentions:
                            adaptive.recent_code_mentions[code_key] = []
                        adaptive.recent_code_mentions[code_key].append(now_ts)
                        # Keep only last 60s of mentions
                        cutoff = now_ts - 60
                        adaptive.recent_code_mentions[code_key] = [
                            t for t in adaptive.recent_code_mentions[code_key] if t > cutoff
                        ]
                    # Bound to last 50 unique codes
                    if len(adaptive.detected_codes) > 50:
                        adaptive.detected_codes = adaptive.detected_codes[-50:]

            # Advance cursor only when we got results
            if next_cursor and comments_data:
                after_cursor = next_cursor

            # Trim to context window
            ctx_win = config.get("context_window", 50)
            if len(recent_comments) > ctx_win:
                recent_comments[:] = recent_comments[-ctx_win:]

            # Signal engage loop that new viewer comments arrived
            if new_count > 0:
                consecutive_empty_polls = 0
                new_comments_event.set()
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
            else:
                consecutive_empty_polls += 1

                # Reset cursor after 5 empty polls, but only once per 2 minutes.
                # After reset, the API returns old comments (already in seen_ids)
                # which still count as "empty" — without cooldown this loops forever.
                if not hasattr(_monitor_loop, '_last_cursor_reset'):
                    _monitor_loop._last_cursor_reset = 0.0
                if consecutive_empty_polls >= 5 and after_cursor:
                    now_mono = monotonic()
                    if now_mono - _monitor_loop._last_cursor_reset > 120:
                        logger.info(
                            "[LiveEngage] Monitor: 5 empty polls, resetting cursor (cooldown 2min)"
                        )
                        after_cursor = None
                        _monitor_loop._last_cursor_reset = now_mono
                        consecutive_empty_polls = 0  # Reset counter after cursor reset

                # Check DB for paused status — freeze empty poll counter
                try:
                    async with SessionLocal() as db:
                        result = await db.execute(
                            select(FBLiveEngageSession.status).where(
                                FBLiveEngageSession.id == uuid.UUID(session_id)
                            )
                        )
                        db_status = result.scalar_one_or_none()
                        if db_status == "paused":
                            consecutive_empty_polls = 0  # Don't count empty polls while paused
                except Exception:
                    pass

                # Stream end detection — only if explicitly enabled (threshold > 0)
                sed_threshold = config.get("stream_end_threshold", 0)
                if sed_threshold > 0 and consecutive_empty_polls >= sed_threshold:
                    logger.info(
                        f"[LiveEngage] Monitor: {consecutive_empty_polls} consecutive empty polls "
                        f"(threshold={sed_threshold}), stream likely ended — stopping"
                    )
                    stop_event.set()
                    break

        except Exception as exc:
            logger.warning(f"[LiveEngage] Monitor: unexpected error: {exc}")

        await asyncio.sleep(config["scrape_interval"])


async def _engage_loop(
    client, config, recent_comments, our_content,
    stop_event, new_comments_event, last_seen_count,
    account_pool, session_id, SessionLocal, adaptive,
):
    """Generate and post AI comments when new comments arrive, with adaptive behavior."""
    from sqlalchemy import select
    from app.models.fb_live_engage import FBLiveEngageSession, FBLiveEngageLog
    from app.services.ai_live_engage import AILiveEngageService

    ai_service = AILiveEngageService()
    account_idx = 0
    post_id = config["post_id"]
    session_start = datetime.now(timezone.utc)
    max_duration_secs = config["max_duration_minutes"] * 60

    # Target pacing mode
    target_enabled = config.get("target_comments_enabled", False)
    target_count = config.get("target_comments_count", 0)
    target_period_secs = config.get("target_comments_period_minutes", 60) * 60
    comments_posted_this_period = 0
    period_start = monotonic()

    # Account health tracking — remove accounts after 5 consecutive errors
    account_errors: dict[str, int] = {}  # email → consecutive error count
    token_errors: dict[str, int] = {}  # email → token error count (switch to AKNG after 3)
    token_disabled: set[str] = set()  # emails where token has no permission (skip permanently)
    account_last_used: dict[str, float] = {}  # email → monotonic timestamp
    account_cooldown_secs = max(30, len(account_pool) * 10)  # at least 30s, scales with pool size
    accounts_tried: set[str] = set()  # track which accounts have been attempted
    consecutive_errors = 0  # tracks consecutive failures for logging

    # Comment without new viewer comments
    comment_without_new = config.get("comment_without_new", False)
    comment_without_new_max = config.get("comment_without_new_max", 3)
    idle_comment_count = 0  # how many comments posted without new viewer comments

    # Blacklist words
    blacklist_raw = config.get("blacklist_words", "")
    blacklist_set = {w.strip().lower() for w in blacklist_raw.split(",") if w.strip()} if blacklist_raw else set()

    # Build role weights for random.choices
    base_role_dist = config["role_distribution"]
    roles = list(base_role_dist.keys())
    weights = [base_role_dist[r] for r in roles]

    # Track posted comments for anti-repetition
    posted_history: list[str] = []  # Ordered list of our posted comment texts
    last_role: str | None = None     # Avoid picking the same role consecutively
    metrics_update_counter = 0  # update live metrics every 5 comments

    while not stop_event.is_set():
        try:
            # Check max duration
            elapsed = (datetime.now(timezone.utc) - session_start).total_seconds()
            if elapsed >= max_duration_secs:
                logger.info(f"[LiveEngage] Session {session_id} reached max duration ({config['max_duration_minutes']}m), stopping")
                stop_event.set()
                break

            # ── Check status + pending actions ─────────────────
            try:
                db_status = None
                pending_actions = None
                async with SessionLocal() as db:
                    result = await db.execute(
                        select(FBLiveEngageSession.status, FBLiveEngageSession.pending_actions).where(
                            FBLiveEngageSession.id == uuid.UUID(session_id)
                        )
                    )
                    row = result.one_or_none()
                    if row:
                        db_status, pending_actions = row

                # ── Handle trigger queue ──
                if pending_actions and pending_actions.get("trigger_queue"):
                    queue = pending_actions["trigger_queue"]
                    # Find next pending trigger
                    next_trigger = None
                    for t in queue:
                        if t.get("status") == "pending":
                            next_trigger = t
                            break

                    if next_trigger:
                        t_id = next_trigger["id"]
                        t_code = next_trigger["code"]
                        t_count = next_trigger.get("count", 5)
                        t_dur = next_trigger.get("duration_minutes", 2) * 60
                        logger.info(f"[LiveEngage] Trigger queue: {t_code} x{t_count} (id={t_id})")

                        # Mark as running in DB
                        async with SessionLocal() as db:
                            result = await db.execute(
                                select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                            )
                            s = result.scalar_one()
                            pa = dict(s.pending_actions or {})
                            for t in pa.get("trigger_queue", []):
                                if t["id"] == t_id:
                                    t["status"] = "running"
                            s.pending_actions = pa
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(s, "pending_actions")
                            await db.commit()

                        # Burst: post the code t_count times
                        burst_delay = max(3, t_dur / max(t_count, 1))
                        for burst_i in range(t_count):
                            if stop_event.is_set():
                                break

                            # Check if trigger was paused/deleted
                            try:
                                async with SessionLocal() as db:
                                    result = await db.execute(
                                        select(FBLiveEngageSession.pending_actions).where(
                                            FBLiveEngageSession.id == uuid.UUID(session_id)
                                        )
                                    )
                                    current_pa = result.scalar_one_or_none() or {}
                                    current_queue = current_pa.get("trigger_queue", [])
                                    trigger_state = next((t for t in current_queue if t.get("id") == t_id), None)
                                    if not trigger_state or trigger_state.get("status") in ("paused", "deleted"):
                                        logger.info(f"[LiveEngage] Trigger {t_id} {trigger_state.get('status', 'deleted')}, skipping")
                                        break
                            except Exception:
                                pass

                            if not account_pool:
                                break
                            acct = account_pool[account_idx % len(account_pool)]
                            account_idx += 1

                            qty = random.choices([1, 2, 3], weights=[6, 3, 1], k=1)[0]
                            roll = random.random()
                            if roll < 0.4:
                                burst_content = f"{t_code} +{qty}"
                            elif roll < 0.6:
                                burst_content = f"+1 {t_code}"
                            else:
                                burst_content = t_code

                            try:
                                b_success = False
                                # Token-first priority (same as main engage loop)
                                if acct.get("token"):
                                    try:
                                        resp = await client.comment_direct(acct["token"], post_id, burst_content)
                                        b_success = resp.get("success", False)
                                    except Exception:
                                        pass
                                # Fallback to AKNG cookies
                                if not b_success and acct.get("cookie"):
                                    try:
                                        resp = await client.execute_action(
                                            cookie=acct["cookie"], user_agent=acct["user_agent"],
                                            action_name="comment_to_post",
                                            params={"post_id": post_id, "content": burst_content, "image": ""},
                                            proxy=acct.get("proxy"),
                                        )
                                        b_success, _ = _parse_response(resp)
                                    except Exception:
                                        pass
                            except Exception:
                                b_success = False

                            if b_success:
                                our_content.add(burst_content)
                                posted_history.append(burst_content)

                            # Log to activity
                            try:
                                async with SessionLocal() as db:
                                    log = FBLiveEngageLog(
                                        session_id=uuid.UUID(session_id),
                                        role="triggered",
                                        content=burst_content,
                                        account_email=acct["email"],
                                        reference_comment=f"Trigger [{t_id}]: {t_code} ({burst_i+1}/{t_count})",
                                        status="success" if b_success else "failed",
                                        error_message=None if b_success else "Burst post failed",
                                    )
                                    db.add(log)
                                    result = await db.execute(
                                        select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                                    )
                                    s = result.scalar_one()
                                    if b_success:
                                        s.total_comments_posted += 1
                                        by_role = dict(s.comments_by_role or {})
                                        by_role["triggered"] = by_role.get("triggered", 0) + 1
                                        s.comments_by_role = by_role
                                    else:
                                        s.total_errors += 1
                                    await db.commit()
                            except Exception:
                                pass

                            logger.info(f"[LiveEngage] Trigger [{t_id}] {burst_i+1}/{t_count}: {burst_content} via {acct['email'][:20]}")
                            await asyncio.sleep(burst_delay * random.uniform(0.8, 1.2))

                        # Mark trigger as completed in DB
                        try:
                            async with SessionLocal() as db:
                                result = await db.execute(
                                    select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                                )
                                s = result.scalar_one()
                                pa = dict(s.pending_actions or {})
                                for t in pa.get("trigger_queue", []):
                                    if t["id"] == t_id and t["status"] == "running":
                                        t["status"] = "completed"
                                s.pending_actions = pa
                                from sqlalchemy.orm.attributes import flag_modified
                                flag_modified(s, "pending_actions")
                                await db.commit()
                        except Exception:
                            pass

                        logger.info(f"[LiveEngage] Trigger [{t_id}] complete: {t_code}")
                        continue  # check for next trigger in queue

                # ── Handle config reload ──
                if pending_actions and pending_actions.get("reload_config"):
                    async with SessionLocal() as db:
                        result = await db.execute(
                            select(FBLiveEngageSession).where(FBLiveEngageSession.id == uuid.UUID(session_id))
                        )
                        s = result.scalar_one()

                        # Reload mutable config from DB
                        config["role_distribution"] = s.role_distribution or config["role_distribution"]
                        config["aggressive_level"] = s.aggressive_level or config["aggressive_level"]
                        config["min_delay"] = s.min_delay_seconds or config["min_delay"]
                        config["max_delay"] = s.max_delay_seconds or config["max_delay"]
                        config["scrape_interval"] = s.scrape_interval_seconds or config["scrape_interval"]
                        config["context_window"] = s.context_window or 50
                        config["target_comments_enabled"] = bool(s.target_comments_enabled)
                        config["target_comments_count"] = s.target_comments_count or config.get("target_comments_count", 0)
                        config["target_comments_period_minutes"] = s.target_comments_period_minutes or config.get("target_comments_period_minutes", 60)
                        config["comment_without_new"] = bool(s.comment_without_new)
                        config["comment_without_new_max"] = s.comment_without_new_max or 3
                        config["blacklist_words"] = s.blacklist_words or ""
                        config["stream_end_threshold"] = s.stream_end_threshold if s.stream_end_threshold is not None else 10
                        config["languages"] = s.languages or ""
                        config["ai_instructions"] = s.ai_instructions or ""
                        config["auto_order_trending"] = bool(s.auto_order_trending)
                        config["auto_order_trending_threshold"] = s.auto_order_trending_threshold or 3
                        config["auto_order_trending_cooldown"] = s.auto_order_trending_cooldown or 60
                        adaptive.quantity_variation = s.quantity_variation if s.quantity_variation is not None else True
                        adaptive.aggressive_level = s.aggressive_level or "medium"

                        # Refresh code whitelist from seed codes
                        new_seed = s.product_codes or ""
                        config["product_codes"] = new_seed
                        if new_seed:
                            new_codes = [c.strip() for c in new_seed.split(",") if c.strip()]
                            adaptive.code_whitelist = {c.upper() for c in new_codes}
                            # Add new seed codes to detected_codes
                            known = {c.upper() for c in adaptive.detected_codes}
                            for nc in new_codes:
                                if nc.upper() not in known:
                                    adaptive.detected_codes.append(nc)
                                    known.add(nc.upper())

                        # Rebuild role weights
                        base_role_dist.clear()
                        base_role_dist.update(config["role_distribution"])
                        roles[:] = list(base_role_dist.keys())
                        weights[:] = [base_role_dist[r] for r in roles]

                        # Update target pacing
                        target_enabled = config["target_comments_enabled"]
                        target_count = config["target_comments_count"]
                        target_period_secs = config["target_comments_period_minutes"] * 60
                        comment_without_new = config["comment_without_new"]
                        comment_without_new_max = config["comment_without_new_max"]

                        # Update blacklist
                        blacklist_raw = config["blacklist_words"]
                        blacklist_set.clear()
                        if blacklist_raw:
                            blacklist_set.update(w.strip().lower() for w in blacklist_raw.split(",") if w.strip())

                        # Clear reload flag
                        pa = dict(s.pending_actions or {})
                        pa.pop("reload_config", None)
                        s.pending_actions = pa
                        await db.commit()

                    logger.info(f"[LiveEngage] Config reloaded for session {session_id}")

                if db_status == "paused":
                    logger.info(f"[LiveEngage] Session {session_id} paused, waiting...")
                    while db_status == "paused" and not stop_event.is_set():
                        await asyncio.sleep(5)
                        async with SessionLocal() as db:
                            r = await db.execute(
                                select(FBLiveEngageSession.status).where(
                                    FBLiveEngageSession.id == uuid.UUID(session_id)
                                )
                            )
                            db_status = r.scalar_one_or_none()
                    if db_status == "stopped":
                        stop_event.set()
                        break
                    logger.info(f"[LiveEngage] Session {session_id} resumed")
                elif db_status == "stopped":
                    stop_event.set()
                    break
            except Exception:
                pass

            # ── Wait for new comments from monitor loop ──────
            # We wait until the monitor signals fresh viewer comments,
            # then clear the event so we wait again next round.
            try:
                # Aggressive level affects wait timeout: high=10s, medium=30s, low=60s
                wait_timeout = {"low": 60, "medium": 30, "high": 10}.get(
                    adaptive.aggressive_level, 30
                )
                await asyncio.wait_for(new_comments_event.wait(), timeout=wait_timeout)
                # New comments arrived — reset idle counter
                idle_comment_count = 0
            except asyncio.TimeoutError:
                if target_enabled and len(recent_comments) >= 3:
                    # Target mode: proceed to maintain pace
                    pass
                elif comment_without_new and idle_comment_count < comment_without_new_max and len(recent_comments) >= 1:
                    # Comment-without-new mode: generate using existing context
                    idle_comment_count += 1
                    logger.debug(
                        f"[LiveEngage] No new comments, idle attempt {idle_comment_count}/{comment_without_new_max}"
                    )
                else:
                    # Normal mode or idle limit reached: loop back
                    if comment_without_new and idle_comment_count >= comment_without_new_max:
                        idle_comment_count = 0  # reset for next cycle
                    continue

            # Clear event — we'll wait for the next batch of new comments
            new_comments_event.clear()

            # Need at least 1 comment for context (3 in strict mode)
            min_comments = 1 if (target_enabled or comment_without_new) else 3
            if len(recent_comments) < min_comments:
                continue

            # Check if there are actually new comments since our last action
            current_count = len(recent_comments)
            if not target_enabled and not comment_without_new and current_count <= last_seen_count[0]:
                continue
            last_seen_count[0] = current_count

            # ── Adaptive recalculation (every ~30s) ──
            now_mono = monotonic()
            if now_mono - adaptive.last_recalc > 30:
                _recalculate_adaptive(adaptive)
                base_order_weight = base_role_dist.get("place_order", 10)
                if adaptive.code_ratio > 0:
                    target_order_pct = min(adaptive.code_ratio * 100, 50)
                    new_order_weight = int(base_order_weight * 0.4 + target_order_pct * 0.6)
                    new_order_weight = max(base_order_weight, min(new_order_weight, 50))
                else:
                    new_order_weight = base_order_weight

                total_other = sum(v for k, v in base_role_dist.items() if k != "place_order")
                if total_other > 0 and new_order_weight != base_order_weight:
                    scale = (100 - new_order_weight) / total_other
                    weights = []
                    for r in roles:
                        if r == "place_order":
                            weights.append(new_order_weight)
                        else:
                            weights.append(max(1, int(base_role_dist[r] * scale)))
                else:
                    weights = [base_role_dist[r] for r in roles]

                logger.debug(
                    "[LiveEngage] Adaptive: velocity=%.1fcpm, code_ratio=%.2f, "
                    "order_weight=%d, detected_codes=%d",
                    adaptive.velocity_cpm, adaptive.code_ratio,
                    new_order_weight, len(adaptive.detected_codes),
                )

            # ── Auto-order trending codes (alternating with cooldown) ──
            trending_code = None
            if config.get("auto_order_trending", False):
                threshold = config.get("auto_order_trending_threshold", 3)
                cooldown_secs = config.get("auto_order_trending_cooldown", 60)
                now_check = monotonic()

                # Check cooldown — skip if last auto-order was too recent
                since_last = now_check - adaptive.last_auto_order_time
                if since_last >= cooldown_secs:
                    for code_key, timestamps in list(adaptive.recent_code_mentions.items()):
                        # Clean old timestamps (60s window)
                        recent = [t for t in timestamps if now_check - t < 60]
                        adaptive.recent_code_mentions[code_key] = recent
                        if len(recent) >= threshold:
                            # Alternate: ~50% auto-order, ~50% normal
                            recent_auto = [p for p in posted_history[-3:] if code_key.lower() in p.lower()]
                            if len(recent_auto) < 2 and random.random() < 0.5:
                                trending_code = code_key
                                for dc in adaptive.detected_codes:
                                    if dc.upper() == code_key:
                                        trending_code = dc
                                        break
                                adaptive.last_auto_order_time = now_check
                                logger.info(f"[LiveEngage] Trending auto-order: {trending_code} ({len(recent)} mentions, cooldown={cooldown_secs}s)")
                                break

            # Pick role — alternate between auto-order and normal
            if trending_code:
                role = "place_order"
            else:
                role = random.choices(roles, weights=weights, k=1)[0]
            if role == last_role and len(roles) > 1:
                # Re-roll once to avoid consecutive same role
                for _ in range(3):
                    role = random.choices(roles, weights=weights, k=1)[0]
                    if role != last_role:
                        break
            last_role = role

            # Pick account (cooldown-aware — skip recently used accounts)
            if not account_pool:
                logger.error("[LiveEngage] No accounts remaining, stopping")
                stop_event.set()
                break
            account = None
            for attempt in range(len(account_pool)):
                candidate = account_pool[(account_idx + attempt) % len(account_pool)]
                email = candidate["email"]
                last_used = account_last_used.get(email, 0)
                if now_mono - last_used >= account_cooldown_secs or attempt == len(account_pool) - 1:
                    account = candidate
                    account_idx += attempt + 1
                    break
            if not account:
                account = account_pool[account_idx % len(account_pool)]
                account_idx += 1
            account_last_used[account["email"]] = monotonic()

            # Generate comment
            reference_comment = None
            content = None
            try:
                # If trending code triggered place_order, generate directly
                if trending_code and role == "place_order":
                    qty = random.choices([1, 2, 3], weights=[6, 3, 1], k=1)[0]
                    roll = random.random()
                    if adaptive.quantity_variation and roll < 0.4:
                        content = f"{trending_code} +{qty}"
                    elif roll < 0.6:
                        content = f"+1 {trending_code}"
                    else:
                        content = trending_code
                    reference_comment = f"Auto-order trending: {trending_code}"
                    role = "auto_order"

                if not content:
                    if role in ("react_comment", "repeat_question") and recent_comments:
                        # Smart reference selection based on role
                        candidates = recent_comments[-15:]
                        if role == "repeat_question":
                            # Prefer comments that look like questions (? or question words)
                            question_markers = {"?", "？", "吗", "嗎", "多少", "几", "幾", "怎么", "怎麼", "哪", "什么", "什麼", "ada", "berapa", "how", "what", "where", "when", "can"}
                            questions = [c for c in candidates if any(m in c.get("message", "").lower() for m in question_markers)]
                            ref = random.choice(questions) if questions else random.choice(candidates)
                        elif role == "react_comment":
                            # Prefer substantive comments (>5 chars, not just codes/orders)
                            substantive = [c for c in candidates if len(c.get("message", "").strip()) > 5]
                            ref = random.choice(substantive) if substantive else random.choice(candidates)
                        else:
                            ref = random.choice(candidates)
                        reference_comment = f"{ref.get('from_name', '')}: {ref.get('message', '')}"

                    content = await ai_service.generate_comment(
                        role=role,
                        recent_comments=recent_comments,
                    business_context=config["business_context"],
                    training_comments=config["training_comments"],
                    ai_instructions=config["ai_instructions"],
                    reference_comment=reference_comment,
                    posted_history=posted_history,
                    detected_codes=adaptive.detected_codes,
                    quantity_variation=adaptive.quantity_variation,
                    languages=config.get("languages", ""),
                )
            except Exception as exc:
                logger.warning(f"[LiveEngage] AI generation error: {exc}")
                content = None

            if not content:
                continue

            # Blacklist check — regenerate if content contains blacklisted words
            if blacklist_set and any(w in content.lower() for w in blacklist_set):
                logger.debug(f"[LiveEngage] Blacklisted word found, skipping: {content[:50]}")
                continue

            # Track our content so monitor can skip it + AI can avoid repeating
            our_content.add(content)
            posted_history.append(content)
            # Keep history bounded to last 30 comments
            if len(posted_history) > 30:
                posted_history[:] = posted_history[-30:]

            # Execute with retry (up to 3 attempts for transient errors)
            # Priority: Graph API token first → AKNG cookies fallback
            # After 3 token errors per account, switch to AKNG-first for that account
            success = False
            error_msg = None
            email = account["email"]
            use_token_first = (
                account.get("token")
                and email not in token_disabled
                and token_errors.get(email, 0) < 3
            )
            max_retries = 3

            for retry in range(max_retries):
                if use_token_first:
                    # Try direct Graph API token first
                    try:
                        resp = await client.comment_direct(
                            token=account["token"],
                            post_id=post_id,
                            content=content,
                        )
                        success = resp.get("success", False)
                        error_msg = resp.get("error") if not success else None
                    except Exception as exc:
                        success = False
                        error_msg = str(exc)

                    if success:
                        token_errors[email] = 0
                        break

                    # Detect permission errors — disable token permanently for this session
                    if error_msg and any(pe in error_msg.lower() for pe in (
                        "does not exist", "missing permissions", "unsupported post",
                        "not accessible", "(#200)", "(#100)",
                    )):
                        token_disabled.add(email)
                        logger.info(f"[LiveEngage] Token disabled for {email[:20]}: no permission")
                        use_token_first = False
                    else:
                        token_errors[email] = token_errors.get(email, 0) + 1
                        if token_errors[email] >= 3:
                            logger.info(f"[LiveEngage] Token failed 3x for {email[:20]}, switching to AKNG")
                            use_token_first = False

                    # Fallback to AKNG
                    try:
                        resp = await client.execute_action(
                            cookie=account["cookie"],
                            user_agent=account["user_agent"],
                            action_name="comment_to_post",
                            params={"post_id": post_id, "content": content, "image": ""},
                            proxy=account.get("proxy"),
                        )
                    except Exception as exc:
                        resp = {"success": False, "error": str(exc)}
                    success, error_msg = _parse_response(resp)

                else:
                    # AKNG first (no token or token exhausted)
                    try:
                        resp = await client.execute_action(
                            cookie=account["cookie"],
                            user_agent=account["user_agent"],
                            action_name="comment_to_post",
                            params={"post_id": post_id, "content": content, "image": ""},
                            proxy=account.get("proxy"),
                        )
                    except Exception as exc:
                        resp = {"success": False, "error": str(exc)}
                    success, error_msg = _parse_response(resp)

                    # Fallback to token if AKNG failed and token available (not disabled)
                    if not success and account.get("token") and email not in token_disabled:
                        logger.info(f"[LiveEngage] AKNG failed, trying token for {email[:20]}...")
                        try:
                            resp = await client.comment_direct(
                                token=account["token"],
                                post_id=post_id,
                                content=content,
                            )
                            success = resp.get("success", False)
                            error_msg = resp.get("error") if not success else None
                        except Exception as exc:
                            success = False
                            error_msg = str(exc)

                if success:
                    break

                # Check if error is permanent — no point retrying
                if error_msg and any(pe in error_msg.lower() for pe in (
                    "session has been invalidated", "changed their password",
                    "account has been disabled", "checkpoint required",
                    "login required", "account is temporarily locked",
                )):
                    break

                if retry < max_retries - 1:
                    logger.info(f"[LiveEngage] Retry {retry + 1}/{max_retries} for {email[:20]}...")
                    await asyncio.sleep(2 * (retry + 1))

            # Account health tracking
            accounts_tried.add(email)
            if success:
                account_errors[email] = 0
                consecutive_errors = 0
            else:
                account_errors[email] = account_errors.get(email, 0) + 1
                consecutive_errors += 1

                # Detect permanent errors — remove immediately, no retries
                permanent_errors = (
                    "session has been invalidated",
                    "changed their password",
                    "user changed the password",
                    "login required",
                    "account has been disabled",
                    "account is temporarily locked",
                    "checkpoint required",
                )
                is_permanent = error_msg and any(
                    pe in error_msg.lower() for pe in permanent_errors
                )

                # Remove account: immediately for permanent errors, after 3 for transient
                should_remove = is_permanent or account_errors[email] >= 5
                if should_remove and len(account_pool) > 1:
                    account_pool[:] = [a for a in account_pool if a["email"] != email]
                    account_idx = account_idx % len(account_pool) if account_pool else 0
                    reason = "permanent error" if is_permanent else f"{account_errors[email]} consecutive errors"
                    logger.warning(
                        f"[LiveEngage] Removed account {email[:20]}... "
                        f"({reason}, {len(account_pool)} remaining)"
                    )
                    # Don't count permanent removals toward consecutive auto-stop
                    if is_permanent:
                        consecutive_errors = max(0, consecutive_errors - 1)

                # Only auto-stop if ALL accounts are removed (pool empty)
                # Otherwise just log warnings and keep trying with remaining accounts
                if len(account_pool) == 0:
                    logger.warning(f"[LiveEngage] All accounts removed — no accounts left to post with")
                    stop_event.set()
                    break
                elif consecutive_errors > 0 and consecutive_errors % 10 == 0:
                    logger.warning(
                        f"[LiveEngage] {consecutive_errors} consecutive errors "
                        f"(pool={len(account_pool)}, will keep trying)"
                    )

            # Log action
            try:
                async with SessionLocal() as db:
                    log = FBLiveEngageLog(
                        session_id=uuid.UUID(session_id),
                        role=role,
                        content=content,
                        account_email=email,
                        reference_comment=reference_comment,
                        status="success" if success else "failed",
                        error_message=error_msg,
                        response_data=resp if isinstance(resp, dict) else None,
                    )
                    db.add(log)

                    # Update session stats + live metrics
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

                    # Update live metrics every 5 comments
                    metrics_update_counter += 1
                    if metrics_update_counter % 5 == 0:
                        s.live_metrics = {
                            "velocity_cpm": round(adaptive.velocity_cpm, 1),
                            "code_ratio": round(adaptive.code_ratio, 2),
                            "detected_codes": adaptive.detected_codes[:20],
                            "active_accounts": len(account_pool),
                            "consecutive_errors": consecutive_errors,
                        }
                    s.active_accounts = len(account_pool)
                    await db.commit()
            except Exception as exc:
                logger.warning(f"[LiveEngage] Failed to log action: {exc}")

            if success:
                comments_posted_this_period += 1
                logger.info(f"[LiveEngage] Posted {role} comment via {account['email'][:20]}...")
            else:
                logger.warning(f"[LiveEngage] Failed {role} via {account['email'][:20]}: {error_msg}")

        except Exception as exc:
            logger.warning(f"[LiveEngage] Engage loop error: {exc}")

        # ── Calculate delay ──
        if target_enabled and target_count > 0:
            # Target pacing mode: calculate delay to hit N comments per period
            elapsed_in_period = monotonic() - period_start
            remaining_in_period = max(1, target_period_secs - elapsed_in_period)
            remaining_comments = max(1, target_count - comments_posted_this_period)

            # Reset period when it expires
            if elapsed_in_period >= target_period_secs:
                period_start = monotonic()
                comments_posted_this_period = 0
                remaining_in_period = target_period_secs
                remaining_comments = target_count

            # Target delay = remaining time / remaining comments
            target_delay = remaining_in_period / remaining_comments
            # Add ±20% jitter for natural pacing
            delay = target_delay * random.uniform(0.8, 1.2)
            # Clamp to sane bounds (3s min, 300s max)
            delay = max(3, min(delay, 300))

            if comments_posted_this_period % 10 == 0:
                logger.debug(
                    "[LiveEngage] Target pacing: %d/%d posted, %.0fs remaining, delay=%.1fs",
                    comments_posted_this_period, target_count, remaining_in_period, delay,
                )
        else:
            # Normal adaptive delay with aggressive level
            base_min = config["min_delay"]
            base_max = config["max_delay"]

            aggro_multiplier = {"low": 1.5, "medium": 1.0, "high": 0.4}.get(
                adaptive.aggressive_level, 1.0
            )
            base_min *= aggro_multiplier
            base_max *= aggro_multiplier

            if adaptive.velocity_cpm > 5:
                speed_factor = max(0.3, 1.0 - (adaptive.velocity_cpm - 5) / 100)
                adj_min = max(3, base_min * speed_factor)
                adj_max = max(adj_min + 3, base_max * speed_factor)
            else:
                adj_min = base_min
                adj_max = base_max
            delay = random.uniform(adj_min, adj_max)

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
    is_success = success and (status_code is None or status_code == 1)
    error = None if is_success else (status_msg or resp.get("message", "Unknown error"))
    return is_success, error
