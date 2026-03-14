"""Facebook Action Bot API — execute FB actions via AKNG fb_action endpoint."""

import csv
import io
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.fb_action_batch import FBActionBatch
from app.models.fb_action_log import FBActionLog
from app.models.fb_cookie_session import FBCookieSession
from app.models.user import User
from app.scraping.clients.facebook import FacebookGraphClient
from app.scraping.fb_action_tasks import VALID_ACTIONS
from app.services.meta_api import MetaAPIService

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response schemas ───────────────────────────────────────

class ProxyConfig(BaseModel):
    host: str = ""
    port: str = ""
    username: str = ""
    password: str = ""


class ExecuteActionRequest(BaseModel):
    action_name: str
    params: dict
    user_agent: str | None = None
    proxy: ProxyConfig | None = None


class SaveConfigRequest(BaseModel):
    user_agent: str | None = None
    proxy: ProxyConfig | None = None


# ── POST /fb-action/execute ──────────────────────────────────────────

@router.post("/execute")
async def execute_action(
    body: ExecuteActionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a Facebook action using stored cookies + AKNG fb_action API."""
    # Get stored cookie
    result = await db.execute(
        select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=400, detail="No Facebook cookies found. Connect via browser extension first.")

    # Decrypt cookie
    meta = MetaAPIService()
    try:
        cookies_json = meta.decrypt_token(session.cookies_encrypted)
        cookies_list = json.loads(cookies_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to decrypt cookies. Please reconnect via browser extension.")

    # Build cookie string: "name=value; name=value; ..."
    cookie_str = "; ".join(
        f"{c.get('name', c.get('Name', ''))}={c.get('value', c.get('Value', ''))}"
        for c in cookies_list
        if isinstance(c, dict)
    )

    # Use provided UA or fall back to stored one
    ua = body.user_agent or session.user_agent or ""

    # Proxy config
    proxy_dict = None
    if body.proxy and body.proxy.host:
        proxy_dict = body.proxy.model_dump()

    # Execute via AKNG API
    client = FacebookGraphClient()
    try:
        resp = await client.execute_action(
            cookie=cookie_str,
            user_agent=ua,
            action_name=body.action_name,
            params=body.params,
            proxy=proxy_dict,
        )
    except Exception as exc:
        # Log error
        log = FBActionLog(
            tenant_id=user.tenant_id,
            user_id=user.id,
            action_name=body.action_name,
            action_params=body.params,
            status="error",
            error_message=str(exc),
        )
        db.add(log)
        await db.commit()
        raise HTTPException(status_code=502, detail=f"AKNG API error: {exc}")
    finally:
        await client.close()

    # Determine status from response
    success = resp.get("success", False)
    status_code = None
    status_msg = None
    data = resp.get("data", {})
    if isinstance(data, dict):
        status_info = data.get("status", {})
        if isinstance(status_info, dict):
            status_code = status_info.get("code")
            status_msg = status_info.get("message")

    log_status = "success" if success and status_code == 1 else "failed"
    error_msg = None if log_status == "success" else (status_msg or resp.get("message", "Unknown error"))

    # Log action
    log = FBActionLog(
        tenant_id=user.tenant_id,
        user_id=user.id,
        action_name=body.action_name,
        action_params=body.params,
        status=log_status,
        response_data=resp,
        error_message=error_msg,
    )
    db.add(log)
    await db.commit()

    return {
        "success": log_status == "success",
        "status_code": status_code,
        "status_message": status_msg,
        "data": data.get("data") if isinstance(data, dict) else None,
        "raw": resp,
    }


# ── GET /fb-action/history ───────────────────────────────────────────

@router.get("/history")
async def get_action_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    action_name: str | None = Query(None),
):
    """Get paginated action execution history for this tenant."""
    filters = [FBActionLog.tenant_id == user.tenant_id]
    if action_name:
        filters.append(FBActionLog.action_name == action_name)

    # Count
    count_q = select(func.count(FBActionLog.id)).where(*filters)
    total = (await db.execute(count_q)).scalar() or 0

    # Fetch
    q = (
        select(FBActionLog)
        .where(*filters)
        .order_by(FBActionLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    logs = result.scalars().all()

    return {
        "items": [
            {
                "id": str(log.id),
                "action_name": log.action_name,
                "action_params": log.action_params,
                "status": log.status,
                "response_data": log.response_data,
                "error_message": log.error_message,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── GET /fb-action/config ────────────────────────────────────────────

@router.get("/config")
async def get_config(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current FB Action Bot config (cookie status, UA, proxy)."""
    result = await db.execute(
        select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
    )
    session = result.scalar_one_or_none()

    # Read proxy from tenant settings
    from app.models.tenant import Tenant
    t_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = t_result.scalar_one_or_none()
    proxy = (tenant.settings or {}).get("fb_action_proxy") if tenant else None

    return {
        "has_cookies": session is not None,
        "fb_user_id": session.fb_user_id if session else None,
        "is_valid": session.is_valid if session else False,
        "user_agent": session.user_agent if session else None,
        "proxy": proxy,
    }


# ── POST /fb-action/save-config ──────────────────────────────────────

@router.post("/save-config")
async def save_config(
    body: SaveConfigRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save user-agent and proxy settings."""
    # Update UA in cookie session
    if body.user_agent is not None:
        result = await db.execute(
            select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
        )
        session = result.scalar_one_or_none()
        if session:
            session.user_agent = body.user_agent

    # Save proxy in tenant settings
    if body.proxy is not None:
        from app.models.tenant import Tenant
        t_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
        tenant = t_result.scalar_one_or_none()
        if tenant:
            settings = dict(tenant.settings or {})
            settings["fb_action_proxy"] = body.proxy.model_dump()
            tenant.settings = settings

    await db.commit()
    return {"success": True}


# ── CSV Template columns ────────────────────────────────────────────

CSV_COLUMNS = [
    "cookie", "user_agent", "action_name", "repeat_count",
    "input", "content", "images", "image", "video_url", "preset_id",
    "page_id", "group_id", "post_id", "comment_id", "parent_post_id",
    "first", "last", "middle", "bio", "uid",
    "proxy_host", "proxy_port", "proxy_username", "proxy_password",
]


# ── GET /fb-action/batch/csv-template ───────────────────────────────

@router.get("/batch/csv-template")
async def download_csv_template():
    """Download a sample CSV template for batch mode."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)
    # Example rows
    writer.writerow([
        "c_user=123; xs=abc", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "post_to_my_feed", "1",
        "", "Hello from batch mode!", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "",
    ])
    writer.writerow([
        "c_user=456; xs=def", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "add_friend", "3",
        "", "", "", "", "", "",
        "", "", "", "", "",
        "", "", "", "", "100001234567",
        "", "", "", "",
    ])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=fb_action_batch_template.csv"},
    )


# ── POST /fb-action/batch/upload ────────────────────────────────────

@router.post("/batch/upload")
async def upload_batch(
    file: UploadFile = File(...),
    settings_json: str = Form("{}"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload CSV and start a batch execution."""
    # Validate file
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    # Parse settings
    try:
        batch_settings = json.loads(settings_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid settings JSON")

    execution_mode = batch_settings.get("execution_mode", "sequential")
    if execution_mode not in ("sequential", "concurrent"):
        execution_mode = "sequential"
    delay_seconds = max(1.0, min(30.0, float(batch_settings.get("delay_seconds", 5.0))))
    max_parallel = max(1, min(10, int(batch_settings.get("max_parallel", 3))))
    proxy_config = batch_settings.get("proxy")
    if proxy_config and not proxy_config.get("host"):
        proxy_config = None

    # Parse CSV
    try:
        text = contents.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        text = contents.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty or has no headers")

    # Validate required columns exist
    fields_lower = {f.strip().lower() for f in reader.fieldnames}
    if "cookie" not in fields_lower or "action_name" not in fields_lower:
        raise HTTPException(
            status_code=400,
            detail="CSV must have 'cookie' and 'action_name' columns"
        )

    # Parse rows
    rows = []
    errors = []
    for i, raw_row in enumerate(reader, start=2):  # row 2+ (1 is header)
        row = {k.strip().lower(): (v or "").strip() for k, v in raw_row.items() if k}

        if not row.get("cookie"):
            errors.append(f"Row {i}: missing cookie")
            continue
        action = row.get("action_name", "")
        if action not in VALID_ACTIONS:
            errors.append(f"Row {i}: invalid action '{action}'")
            continue

        repeat = 1
        try:
            repeat = max(1, min(50, int(row.get("repeat_count") or 1)))
        except ValueError:
            pass
        row["repeat_count"] = repeat
        rows.append(row)

    if errors and not rows:
        raise HTTPException(status_code=400, detail=f"All rows invalid: {'; '.join(errors[:5])}")

    # Cap total actions
    total_actions = sum(r.get("repeat_count", 1) for r in rows)
    if total_actions > 500:
        raise HTTPException(
            status_code=400,
            detail=f"Total actions ({total_actions}) exceeds limit of 500. Reduce rows or repeat counts."
        )

    # Encrypt CSV data
    meta = MetaAPIService()
    encrypted = meta.encrypt_token(json.dumps(rows))

    # Create batch
    batch = FBActionBatch(
        tenant_id=user.tenant_id,
        user_id=user.id,
        status="pending",
        total_rows=total_actions,
        execution_mode=execution_mode,
        delay_seconds=delay_seconds,
        max_parallel=max_parallel,
        csv_data_encrypted=encrypted,
        proxy_config=proxy_config,
    )
    db.add(batch)
    await db.commit()
    await db.refresh(batch)

    # Dispatch Celery task
    from app.scraping.fb_action_tasks import run_fb_action_batch
    task = run_fb_action_batch.delay(str(batch.id))
    batch.celery_task_id = task.id
    await db.commit()

    return {
        "batch_id": str(batch.id),
        "total_rows": len(rows),
        "total_actions": total_actions,
        "errors": errors[:10] if errors else [],
    }


# ── GET /fb-action/batch/{batch_id} ─────────────────────────────────

@router.get("/batch/{batch_id}")
async def get_batch_status(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get batch status and progress."""
    result = await db.execute(
        select(FBActionBatch).where(
            FBActionBatch.id == batch_id,
            FBActionBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    return {
        "id": str(batch.id),
        "status": batch.status,
        "total_rows": batch.total_rows,
        "completed_rows": batch.completed_rows,
        "success_count": batch.success_count,
        "failed_count": batch.failed_count,
        "execution_mode": batch.execution_mode,
        "delay_seconds": batch.delay_seconds,
        "max_parallel": batch.max_parallel,
        "error_message": batch.error_message,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "started_at": batch.started_at.isoformat() if batch.started_at else None,
        "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
    }


# ── GET /fb-action/batch/history ─────────────────────────────────────

@router.get("/batch/history")
async def get_batch_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
):
    """Get paginated batch history for this tenant."""
    filters = [FBActionBatch.tenant_id == user.tenant_id]

    count_q = select(func.count(FBActionBatch.id)).where(*filters)
    total = (await db.execute(count_q)).scalar() or 0

    q = (
        select(FBActionBatch)
        .where(*filters)
        .order_by(FBActionBatch.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    batches = result.scalars().all()

    return {
        "items": [
            {
                "id": str(b.id),
                "status": b.status,
                "total_rows": b.total_rows,
                "completed_rows": b.completed_rows,
                "success_count": b.success_count,
                "failed_count": b.failed_count,
                "execution_mode": b.execution_mode,
                "created_at": b.created_at.isoformat() if b.created_at else None,
                "completed_at": b.completed_at.isoformat() if b.completed_at else None,
            }
            for b in batches
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── POST /fb-action/batch/{batch_id}/cancel ──────────────────────────

@router.post("/batch/{batch_id}/cancel")
async def cancel_batch(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a running batch."""
    result = await db.execute(
        select(FBActionBatch).where(
            FBActionBatch.id == batch_id,
            FBActionBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel batch with status '{batch.status}'")

    batch.status = "cancelled"
    await db.commit()
    return {"success": True}


# ── GET /fb-action/batch/{batch_id}/export ───────────────────────────

@router.get("/batch/{batch_id}/export")
async def export_batch_results(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export batch results as CSV download."""
    # Verify ownership
    result = await db.execute(
        select(FBActionBatch).where(
            FBActionBatch.id == batch_id,
            FBActionBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Fetch all logs for this batch
    result = await db.execute(
        select(FBActionLog)
        .where(FBActionLog.batch_id == batch_id)
        .order_by(FBActionLog.created_at)
    )
    logs = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["#", "Action", "Status", "Error", "Response Summary", "Time"])
    for i, log in enumerate(logs, 1):
        # Build a short response summary
        summary = ""
        if log.response_data and isinstance(log.response_data, dict):
            data = log.response_data.get("data", {})
            if isinstance(data, dict):
                inner = data.get("data", {})
                if isinstance(inner, dict):
                    summary = "; ".join(f"{k}={v}" for k, v in inner.items())

        writer.writerow([
            i,
            log.action_name,
            log.status,
            log.error_message or "",
            summary,
            log.created_at.isoformat() if log.created_at else "",
        ])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=batch_{batch_id}_results.csv"},
    )
