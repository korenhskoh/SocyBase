"""Celery task for bulk Facebook login execution."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.celery_app import celery_app
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(name="app.scraping.fb_login_tasks.run_fb_login_batch", bind=True)
def run_fb_login_batch(self, batch_id: str, headless: bool = True):
    """Process a bulk login batch. Runs in Celery worker."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_execute_login_batch(batch_id, headless=headless))
    finally:
        loop.close()


async def _execute_login_batch(batch_id: str, headless: bool = True):
    """Core async login batch processor."""
    import uuid
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    from app.models.fb_login_batch import FBLoginBatch
    from app.services.meta_api import MetaAPIService

    local_engine = create_async_engine(
        settings.async_database_url, pool_pre_ping=True, pool_size=5, max_overflow=5
    )
    local_session = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with local_session() as db:
            # Load batch
            result = await db.execute(
                select(FBLoginBatch).where(FBLoginBatch.id == uuid.UUID(batch_id))
            )
            batch = result.scalar_one_or_none()
            if not batch:
                logger.error(f"Login batch {batch_id} not found")
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

            batch.total_rows = len(rows)
            await db.commit()

            proxy_pool = batch.proxy_pool or []

            if batch.execution_mode == "concurrent":
                await _run_concurrent(db, batch, rows, proxy_pool, meta, local_session, headless)
            else:
                await _run_sequential(db, batch, rows, proxy_pool, meta, headless)

            # Finalize
            await db.refresh(batch)
            if batch.status == "cancelled":
                pass
            elif batch.failed_count == batch.total_rows:
                batch.status = "failed"
            else:
                batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)
            batch.csv_data_encrypted = None  # clear sensitive data
            await db.commit()

    except Exception as exc:
        logger.exception(f"Login batch {batch_id} crashed: {exc}")
        try:
            async with local_session() as db:
                result = await db.execute(
                    select(FBLoginBatch).where(FBLoginBatch.id == uuid.UUID(batch_id))
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


def _select_proxy(row: dict, proxy_pool: list, index: int) -> dict | None:
    """Select proxy: per-row first, then round-robin from pool, then None."""
    host = row.get("proxy_host", "")
    if host:
        return {
            "host": host,
            "port": row.get("proxy_port", ""),
            "username": row.get("proxy_username", ""),
            "password": row.get("proxy_password", ""),
        }
    if proxy_pool:
        return proxy_pool[index % len(proxy_pool)]
    return None


async def _run_sequential(db, batch, rows, proxy_pool, meta, headless=True):
    """Execute logins one by one with delay."""
    for i, row in enumerate(rows):
        # Check cancellation
        await db.refresh(batch)
        if batch.status == "cancelled":
            break

        proxy = _select_proxy(row, proxy_pool, i)
        await _execute_single_login(db, batch, row, proxy, meta, headless)

        # Update progress
        batch.completed_rows = i + 1
        await db.commit()

        # Delay between logins (skip after last)
        if i < len(rows) - 1 and batch.status != "cancelled":
            await asyncio.sleep(batch.delay_seconds)


async def _run_concurrent(db, batch, rows, proxy_pool, meta, parent_session, headless=True):
    """Execute logins concurrently with semaphore."""
    import uuid
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.models.fb_login_batch import FBLoginBatch

    semaphore = asyncio.Semaphore(batch.max_parallel)
    counter_lock = asyncio.Lock()

    local_engine = create_async_engine(
        settings.async_database_url, pool_pre_ping=True,
        pool_size=batch.max_parallel + 2, max_overflow=5
    )
    local_session = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)

    batch_id = batch.id
    tenant_id = batch.tenant_id
    user_id = batch.user_id

    async def process_login(index, row):
        async with semaphore:
            # Check cancellation
            async with local_session() as task_db:
                result = await task_db.execute(
                    select(FBLoginBatch.status).where(FBLoginBatch.id == batch_id)
                )
                status = result.scalar_one_or_none()
                if status == "cancelled":
                    return

                proxy = _select_proxy(row, proxy_pool, index)
                await _execute_single_login_concurrent(
                    task_db, batch_id, tenant_id, user_id, row, proxy, meta, headless
                )

            # Update progress
            async with counter_lock:
                async with local_session() as cnt_db:
                    result = await cnt_db.execute(
                        select(FBLoginBatch).where(FBLoginBatch.id == batch_id)
                    )
                    b = result.scalar_one()
                    b.completed_rows += 1
                    await cnt_db.commit()

    try:
        await asyncio.gather(
            *(process_login(i, r) for i, r in enumerate(rows)),
            return_exceptions=True,
        )
    finally:
        await local_engine.dispose()


async def _execute_single_login(db, batch, row, proxy, meta, headless=True):
    """Login a single account (sequential mode — shared DB session)."""
    from app.models.fb_login_result import FBLoginResult
    from app.scraping.clients.facebook_login import fb_mbasic_login

    email = row.get("email", "")
    password = row.get("password", "")
    totp_secret = row.get("2fa_secret", "")

    try:
        result = await fb_mbasic_login(
            email=email,
            password=password,
            totp_secret=totp_secret or None,
            proxy=proxy,
            headless=headless,
        )
    except Exception as exc:
        log = FBLoginResult(
            login_batch_id=batch.id, tenant_id=batch.tenant_id, user_id=batch.user_id,
            email=email, status="error", error_message=str(exc), proxy_used=proxy,
        )
        db.add(log)
        batch.failed_count += 1
        await db.commit()
        return

    if result["success"]:
        encrypted_cookie = meta.encrypt_token(result["cookie_string"])
        log = FBLoginResult(
            login_batch_id=batch.id, tenant_id=batch.tenant_id, user_id=batch.user_id,
            email=email, fb_user_id=result["fb_user_id"],
            cookie_encrypted=encrypted_cookie, user_agent=result["user_agent"],
            proxy_used=proxy, status="success",
        )
        db.add(log)
        batch.success_count += 1
    else:
        log = FBLoginResult(
            login_batch_id=batch.id, tenant_id=batch.tenant_id, user_id=batch.user_id,
            email=email, user_agent=result["user_agent"],
            proxy_used=proxy, status="failed", error_message=result["error"],
        )
        db.add(log)
        batch.failed_count += 1
    await db.commit()


async def _execute_single_login_concurrent(db, batch_id, tenant_id, user_id, row, proxy, meta, headless=True):
    """Login a single account (concurrent mode — own DB session)."""
    from sqlalchemy import select
    from app.models.fb_login_batch import FBLoginBatch
    from app.models.fb_login_result import FBLoginResult
    from app.scraping.clients.facebook_login import fb_mbasic_login

    email = row.get("email", "")
    password = row.get("password", "")
    totp_secret = row.get("2fa_secret", "")

    try:
        result = await fb_mbasic_login(
            email=email,
            password=password,
            totp_secret=totp_secret or None,
            proxy=proxy,
            headless=headless,
        )
    except Exception as exc:
        log = FBLoginResult(
            login_batch_id=batch_id, tenant_id=tenant_id, user_id=user_id,
            email=email, status="error", error_message=str(exc), proxy_used=proxy,
        )
        db.add(log)
        r = await db.execute(select(FBLoginBatch).where(FBLoginBatch.id == batch_id))
        b = r.scalar_one()
        b.failed_count += 1
        await db.commit()
        return

    if result["success"]:
        encrypted_cookie = meta.encrypt_token(result["cookie_string"])
        log = FBLoginResult(
            login_batch_id=batch_id, tenant_id=tenant_id, user_id=user_id,
            email=email, fb_user_id=result["fb_user_id"],
            cookie_encrypted=encrypted_cookie, user_agent=result["user_agent"],
            proxy_used=proxy, status="success",
        )
        db.add(log)
        r = await db.execute(select(FBLoginBatch).where(FBLoginBatch.id == batch_id))
        b = r.scalar_one()
        b.success_count += 1
    else:
        log = FBLoginResult(
            login_batch_id=batch_id, tenant_id=tenant_id, user_id=user_id,
            email=email, user_agent=result["user_agent"],
            proxy_used=proxy, status="failed", error_message=result["error"],
        )
        db.add(log)
        r = await db.execute(select(FBLoginBatch).where(FBLoginBatch.id == batch_id))
        b = r.scalar_one()
        b.failed_count += 1
    await db.commit()
