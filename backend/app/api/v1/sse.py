import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.utils.security import decode_token
from app.models.user import User
from app.models.job import ScrapingJob
from app.config import get_settings

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)
router = APIRouter()


async def _resolve_user(
    token: str | None,
    db: AsyncSession,
    header_user: User | None,
) -> User:
    """Resolve the authenticated user from either a query-param token or the
    standard Bearer header (injected via ``get_current_user``).

    EventSource in the browser cannot send custom headers, so we accept an
    optional ``?token=`` query parameter as a fallback.
    """
    # Prefer the header-based user when available
    if header_user is not None:
        return header_user

    # Fall back to the query-param token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


@router.get("/jobs/{job_id}/stream")
async def stream_job_progress(
    job_id: UUID,
    token: str | None = Query(None, description="JWT access token (for EventSource clients)"),
    db: AsyncSession = Depends(get_db),
):
    """SSE endpoint that streams real-time job progress updates.

    Because the browser ``EventSource`` API cannot set custom headers, this
    endpoint accepts an optional ``?token=<jwt>`` query parameter for
    authentication in addition to the standard ``Authorization: Bearer`` header.
    """
    # --- Authenticate ---
    # EventSource cannot send Authorization headers, so we authenticate via
    # the ?token= query parameter.  If no token is provided, reject the request.
    user = await _resolve_user(token, db, None)

    # --- Verify job ownership ---
    result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    settings = get_settings()

    async def event_generator():
        r = aioredis.from_url(settings.redis_url)
        pubsub = r.pubsub()
        channel = f"job_progress:{job_id}"
        await pubsub.subscribe(channel)

        try:
            # Send the initial state so the client has something immediately.
            yield {
                "event": "progress",
                "data": json.dumps({
                    "status": job.status,
                    "progress_pct": float(job.progress_pct),
                    "processed_items": job.processed_items,
                    "total_items": job.total_items,
                    "failed_items": job.failed_items,
                    "result_row_count": job.result_row_count,
                }),
            }

            # If the job is already in a terminal state, close right away.
            if job.status in ("completed", "failed", "cancelled"):
                yield {
                    "event": "done",
                    "data": json.dumps({
                        "status": job.status,
                        "progress_pct": float(job.progress_pct),
                        "processed_items": job.processed_items,
                        "total_items": job.total_items,
                        "failed_items": job.failed_items,
                        "result_row_count": job.result_row_count,
                    }),
                }
                return

            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0,
                )
                if message and message["type"] == "message":
                    data = json.loads(message["data"])
                    yield {"event": "progress", "data": json.dumps(data)}

                    # Stop streaming once the job reaches a terminal state.
                    if data.get("status") in ("completed", "failed", "cancelled"):
                        yield {"event": "done", "data": json.dumps(data)}
                        break
                else:
                    # Keepalive so proxies / browsers don't time out.
                    yield {"event": "ping", "data": ""}

                await asyncio.sleep(0.5)
        finally:
            await pubsub.unsubscribe(channel)
            await r.close()

    return EventSourceResponse(event_generator())
