"""Celery task for batch Facebook action execution."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

VALID_ACTIONS = {
    "get_id", "post_to_my_feed", "page_post_to_feed", "post_to_group",
    "post_reels", "comment_to_post", "page_comment_to_post",
    "reply_to_comment", "change_avatar", "change_name", "change_bio",
    "add_friend", "join_group",
}


@celery_app.task(name="app.scraping.fb_action_tasks.run_fb_action_batch", bind=True)
def run_fb_action_batch(self, batch_id: str):
    """Process a batch of FB actions. Runs in Celery worker."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_execute_batch(batch_id))
    finally:
        loop.close()


async def _execute_batch(batch_id: str):
    """Core async batch processor."""
    import uuid
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    from app.models.fb_action_batch import FBActionBatch
    from app.models.fb_action_log import FBActionLog
    from app.scraping.clients.facebook import FacebookGraphClient
    from app.services.meta_api import MetaAPIService

    local_engine = create_async_engine(
        settings.async_database_url, pool_pre_ping=True, pool_size=5, max_overflow=5
    )
    local_session = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with local_session() as db:
            # Load batch
            result = await db.execute(
                select(FBActionBatch).where(FBActionBatch.id == uuid.UUID(batch_id))
            )
            batch = result.scalar_one_or_none()
            if not batch:
                logger.error(f"Batch {batch_id} not found")
                return

            # Set running
            batch.status = "running"
            batch.started_at = datetime.now(timezone.utc)
            await db.commit()

            # Decrypt CSV data
            meta = MetaAPIService()
            try:
                rows_json = meta.decrypt_token(batch.csv_data_encrypted)
                rows = json.loads(rows_json)
            except Exception as exc:
                batch.status = "failed"
                batch.error_message = f"Failed to decrypt CSV data: {exc}"
                batch.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            # Build the full task list (rows × repeat_count)
            tasks = []
            for row_idx, row in enumerate(rows):
                repeat = int(row.get("repeat_count", 1) or 1)
                for r in range(repeat):
                    tasks.append((row_idx, r, row))

            batch.total_rows = len(tasks)
            await db.commit()

            client = FacebookGraphClient()
            try:
                if batch.execution_mode == "concurrent":
                    await _run_concurrent(db, batch, tasks, client, meta)
                else:
                    await _run_sequential(db, batch, tasks, client, meta)
            finally:
                await client.close()

            # Finalize
            await db.refresh(batch)
            if batch.status == "cancelled":
                pass  # keep cancelled status
            elif batch.failed_count == batch.total_rows:
                batch.status = "failed"
            else:
                batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)
            batch.csv_data_encrypted = None  # clear sensitive data
            await db.commit()

    except Exception as exc:
        logger.exception(f"Batch {batch_id} crashed: {exc}")
        # Try to mark batch as failed
        try:
            async with local_session() as db:
                result = await db.execute(
                    select(FBActionBatch).where(FBActionBatch.id == uuid.UUID(batch_id))
                )
                batch = result.scalar_one_or_none()
                if batch and batch.status == "running":
                    batch.status = "failed"
                    batch.error_message = str(exc)
                    batch.completed_at = datetime.now(timezone.utc)
                    await db.commit()
        except Exception:
            pass
    finally:
        await local_engine.dispose()


async def _run_sequential(db, batch, tasks, client, meta):
    """Execute tasks one by one with a delay between each."""
    from sqlalchemy import select
    from app.models.fb_action_batch import FBActionBatch

    for i, (row_idx, repeat_num, row) in enumerate(tasks):
        # Check cancellation
        await db.refresh(batch)
        if batch.status == "cancelled":
            break

        await _execute_single(db, batch, row, client)

        # Update progress
        batch.completed_rows = i + 1
        await db.commit()

        # Delay between actions (skip after last)
        if i < len(tasks) - 1 and batch.status != "cancelled":
            await asyncio.sleep(batch.delay_seconds)


async def _run_concurrent(db, batch, tasks, client, meta):
    """Execute tasks concurrently with a semaphore limit."""
    import uuid
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.models.fb_action_batch import FBActionBatch

    semaphore = asyncio.Semaphore(batch.max_parallel)
    counter_lock = asyncio.Lock()

    # Each concurrent task needs its own DB session
    local_engine = create_async_engine(
        settings.async_database_url, pool_pre_ping=True, pool_size=batch.max_parallel + 2, max_overflow=5
    )
    local_session = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)

    batch_id = batch.id
    tenant_id = batch.tenant_id
    user_id = batch.user_id

    async def process_task(row_idx, repeat_num, row):
        async with semaphore:
            # Check cancellation
            async with local_session() as task_db:
                result = await task_db.execute(
                    select(FBActionBatch.status).where(FBActionBatch.id == batch_id)
                )
                status = result.scalar_one_or_none()
                if status == "cancelled":
                    return

                await _execute_single_concurrent(
                    task_db, batch_id, tenant_id, user_id, row, client
                )

            # Update progress
            async with counter_lock:
                async with local_session() as cnt_db:
                    result = await cnt_db.execute(
                        select(FBActionBatch).where(FBActionBatch.id == batch_id)
                    )
                    b = result.scalar_one()
                    b.completed_rows += 1
                    await cnt_db.commit()

    try:
        await asyncio.gather(
            *(process_task(ri, rn, r) for ri, rn, r in tasks),
            return_exceptions=True,
        )
    finally:
        await local_engine.dispose()


async def _execute_single(db, batch, row, client):
    """Execute a single action and log it (sequential mode — shared DB session)."""
    from app.models.fb_action_log import FBActionLog

    action_name = row.get("action_name", "")
    params = _build_params(row)
    cookie = row.get("cookie", "")
    ua = row.get("user_agent", "")
    proxy = _build_proxy(row, batch.proxy_config)

    try:
        resp = await client.execute_action(
            cookie=cookie,
            user_agent=ua,
            action_name=action_name,
            params=params,
            proxy=proxy,
        )
    except Exception as exc:
        log = FBActionLog(
            tenant_id=batch.tenant_id,
            user_id=batch.user_id,
            batch_id=batch.id,
            action_name=action_name,
            action_params=params,
            status="error",
            error_message=str(exc),
        )
        db.add(log)
        batch.failed_count += 1
        await db.commit()
        return

    success, status_msg = _parse_response(resp)
    log = FBActionLog(
        tenant_id=batch.tenant_id,
        user_id=batch.user_id,
        batch_id=batch.id,
        action_name=action_name,
        action_params=params,
        status="success" if success else "failed",
        response_data=resp,
        error_message=None if success else status_msg,
    )
    db.add(log)
    if success:
        batch.success_count += 1
    else:
        batch.failed_count += 1
    await db.commit()


async def _execute_single_concurrent(db, batch_id, tenant_id, user_id, row, client):
    """Execute a single action and log it (concurrent mode — own DB session)."""
    from app.models.fb_action_log import FBActionLog
    from app.models.fb_action_batch import FBActionBatch

    action_name = row.get("action_name", "")
    params = _build_params(row)
    cookie = row.get("cookie", "")
    ua = row.get("user_agent", "")

    # Get batch proxy config
    from sqlalchemy import select
    result = await db.execute(
        select(FBActionBatch.proxy_config).where(FBActionBatch.id == batch_id)
    )
    proxy_config = result.scalar_one_or_none()
    proxy = _build_proxy(row, proxy_config)

    try:
        resp = await client.execute_action(
            cookie=cookie,
            user_agent=ua,
            action_name=action_name,
            params=params,
            proxy=proxy,
        )
    except Exception as exc:
        log = FBActionLog(
            tenant_id=tenant_id,
            user_id=user_id,
            batch_id=batch_id,
            action_name=action_name,
            action_params=params,
            status="error",
            error_message=str(exc),
        )
        db.add(log)
        # Update failed count
        result = await db.execute(
            select(FBActionBatch).where(FBActionBatch.id == batch_id)
        )
        b = result.scalar_one()
        b.failed_count += 1
        await db.commit()
        return

    success, status_msg = _parse_response(resp)
    log = FBActionLog(
        tenant_id=tenant_id,
        user_id=user_id,
        batch_id=batch_id,
        action_name=action_name,
        action_params=params,
        status="success" if success else "failed",
        response_data=resp,
        error_message=None if success else status_msg,
    )
    db.add(log)
    # Update success/failed count
    result = await db.execute(
        select(FBActionBatch).where(FBActionBatch.id == batch_id)
    )
    b = result.scalar_one()
    if success:
        b.success_count += 1
    else:
        b.failed_count += 1
    await db.commit()


def _build_params(row: dict) -> dict:
    """Extract action params from a CSV row dict."""
    param_keys = [
        "input", "content", "images", "image", "video_url", "preset_id",
        "page_id", "group_id", "post_id", "comment_id", "parent_post_id",
        "first", "last", "middle", "bio", "uid",
    ]
    params = {}
    for k in param_keys:
        val = row.get(k, "")
        if val:
            if k == "images":
                params[k] = [s.strip() for s in val.split(",") if s.strip()]
            else:
                params[k] = val
    return params


def _build_proxy(row: dict, batch_proxy: dict | None) -> dict | None:
    """Build proxy dict from per-row columns or batch-level fallback."""
    host = row.get("proxy_host", "")
    if host:
        return {
            "host": host,
            "port": row.get("proxy_port", ""),
            "username": row.get("proxy_username", ""),
            "password": row.get("proxy_password", ""),
        }
    if batch_proxy and batch_proxy.get("host"):
        return batch_proxy
    return None


def _parse_response(resp: dict) -> tuple[bool, str | None]:
    """Parse AKNG response to determine success and status message."""
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
