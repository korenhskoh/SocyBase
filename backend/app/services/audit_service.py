"""Audit log service — thin helper to create AuditLog entries.

Usage from async endpoints (with DB session + request):
    await write_audit(db, "job.created", user=current_user, request=request,
                      resource_type="scraping_job", resource_id=job.id,
                      details={"job_type": "full_pipeline"})

Usage from background tasks (no request context):
    await write_audit_bg("job.failed", user_id=job.user_id, tenant_id=job.tenant_id,
                         resource_type="scraping_job", resource_id=job.id,
                         details={"error": str(e)})
"""

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog

logger = logging.getLogger(__name__)


async def write_audit(
    db: AsyncSession,
    action: str,
    *,
    user=None,
    user_id: UUID | None = None,
    tenant_id: UUID | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    details: dict | None = None,
    request=None,
) -> None:
    """Write an audit log entry using an existing DB session.

    Use this in API endpoints where you already have a db session and request.
    """
    try:
        uid = user_id or (getattr(user, "id", None) if user else None)
        tid = tenant_id or (getattr(user, "tenant_id", None) if user else None)
        ip = None
        ua = None
        if request:
            ip = getattr(request, "client", None)
            if ip:
                ip = ip.host
            ua = (request.headers.get("user-agent") or "")[:500]

        entry = AuditLog(
            user_id=uid,
            tenant_id=tid,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            ip_address=ip,
            user_agent=ua,
        )
        db.add(entry)
        await db.flush()
    except Exception as e:
        logger.warning(f"Failed to write audit log ({action}): {e}")


async def write_audit_bg(
    action: str,
    *,
    user_id: UUID | None = None,
    tenant_id: UUID | None = None,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    details: dict | None = None,
) -> None:
    """Write an audit log entry from a background task (opens its own session).

    Use this in Celery tasks / pipelines where there is no request context.
    """
    try:
        from app.database import async_session

        async with async_session() as db:
            entry = AuditLog(
                user_id=user_id,
                tenant_id=tenant_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                details=details or {},
            )
            db.add(entry)
            await db.commit()
    except Exception as e:
        logger.warning(f"Failed to write bg audit log ({action}): {e}")
