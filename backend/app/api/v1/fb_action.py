"""Facebook Action Bot API — execute FB actions via AKNG fb_action endpoint."""

import csv
import io
import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.credit import CreditBalance, CreditTransaction
from app.models.fb_action_batch import FBActionBatch
from app.models.fb_action_log import FBActionLog
from app.models.fb_cookie_session import FBCookieSession
from app.models.fb_live_engage import FBLiveEngageSession, FBLiveEngageLog, VALID_ROLES
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


class AIPlanPost(BaseModel):
    post_id: str
    message: str | None = None
    from_name: str | None = None
    reaction_count: int = 0
    comment_count: int = 0
    share_count: int = 0
    attachment_type: str | None = None
    post_url: str | None = None


class AIPlanGenerateRequest(BaseModel):
    posts: list[AIPlanPost]
    action_types: list[str]
    business_context: str = ""
    actions_per_post: int = Field(default=3, ge=1, le=5)
    page_id: str | None = None
    group_id: str | None = None
    include_comments: bool = True


class AIPlanExportRequest(BaseModel):
    actions: list[dict]
    login_batch_id: str | None = None


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


# ══════════════════════════════════════════════════════════════════════
# Bulk Login — login multiple accounts, capture cookies, export CSV
# ══════════════════════════════════════════════════════════════════════

LOGIN_CSV_COLUMNS = [
    "email", "password", "2fa_secret",
    "proxy_host", "proxy_port", "proxy_username", "proxy_password",
]


# ── GET /fb-action/login-batch/accounts-template ─────────────────────

@router.get("/login-batch/accounts-template")
async def download_login_template():
    """Download CSV template for bulk login."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(LOGIN_CSV_COLUMNS)
    writer.writerow(["user@example.com", "password123", "JBSWY3DPEHPK3PXP", "", "", "", ""])
    writer.writerow(["user2@example.com", "pass456", "", "proxy.host.com", "8080", "proxyuser", "proxypass"])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=fb_login_accounts_template.csv"},
    )


# ── GET /fb-action/login-batch/history ───────────────────────────────

@router.get("/login-batch/history")
async def get_login_batch_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
):
    """Get paginated login batch history."""
    from app.models.fb_login_batch import FBLoginBatch

    filters = [FBLoginBatch.tenant_id == user.tenant_id]

    count_q = select(func.count(FBLoginBatch.id)).where(*filters)
    total = (await db.execute(count_q)).scalar() or 0

    q = (
        select(FBLoginBatch)
        .where(*filters)
        .order_by(FBLoginBatch.created_at.desc())
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


# ── POST /fb-action/login-batch/upload ───────────────────────────────

@router.post("/login-batch/upload")
async def upload_login_batch(
    file: UploadFile = File(...),
    settings_json: str = Form("{}"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload accounts CSV and start bulk login."""
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
    delay_seconds = max(3.0, min(60.0, float(batch_settings.get("delay_seconds", 10.0))))
    max_parallel = max(1, min(5, int(batch_settings.get("max_parallel", 2))))

    # Parse proxy pool
    proxy_pool_raw = batch_settings.get("proxy_pool", [])
    proxy_pool = []
    for p in proxy_pool_raw:
        if isinstance(p, dict) and p.get("host"):
            proxy_pool.append({
                "host": p["host"],
                "port": str(p.get("port", "")),
                "username": p.get("username", ""),
                "password": p.get("password", ""),
            })

    # Parse CSV
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = contents.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV is empty")

    fields_lower = {f.strip().lower() for f in reader.fieldnames}
    if "email" not in fields_lower or "password" not in fields_lower:
        raise HTTPException(status_code=400, detail="CSV must have 'email' and 'password' columns")

    rows = []
    errors = []
    for i, raw_row in enumerate(reader, start=2):
        row = {k.strip().lower(): (v or "").strip() for k, v in raw_row.items() if k}
        if not row.get("email"):
            errors.append(f"Row {i}: missing email")
            continue
        if not row.get("password"):
            errors.append(f"Row {i}: missing password")
            continue
        rows.append(row)

    if errors and not rows:
        raise HTTPException(status_code=400, detail=f"All rows invalid: {'; '.join(errors[:5])}")

    if len(rows) > 200:
        raise HTTPException(status_code=400, detail=f"Too many accounts ({len(rows)}). Max 200 per batch.")

    # Encrypt CSV data
    meta = MetaAPIService()
    encrypted = meta.encrypt_token(json.dumps(rows))

    # Create batch
    from app.models.fb_login_batch import FBLoginBatch

    batch = FBLoginBatch(
        tenant_id=user.tenant_id,
        user_id=user.id,
        status="pending",
        total_rows=len(rows),
        execution_mode=execution_mode,
        delay_seconds=delay_seconds,
        max_parallel=max_parallel,
        csv_data_encrypted=encrypted,
        proxy_pool=proxy_pool if proxy_pool else None,
    )
    db.add(batch)
    await db.commit()
    await db.refresh(batch)

    # Dispatch Celery task
    from app.scraping.fb_login_tasks import run_fb_login_batch
    task = run_fb_login_batch.delay(str(batch.id))
    batch.celery_task_id = task.id
    await db.commit()

    return {
        "batch_id": str(batch.id),
        "total_rows": len(rows),
        "errors": errors[:10] if errors else [],
    }


# ── GET /fb-action/login-batch/{batch_id} ────────────────────────────

@router.get("/login-batch/{batch_id}")
async def get_login_batch_status(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get login batch status and progress."""
    from app.models.fb_login_batch import FBLoginBatch

    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == batch_id,
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Login batch not found")

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


# ── POST /fb-action/login-batch/{batch_id}/cancel ────────────────────

@router.post("/login-batch/{batch_id}/cancel")
async def cancel_login_batch(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a running login batch."""
    from app.models.fb_login_batch import FBLoginBatch

    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == batch_id,
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Login batch not found")
    if batch.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel batch with status '{batch.status}'")

    batch.status = "cancelled"
    await db.commit()
    return {"success": True}


# ── GET /fb-action/login-batch/{batch_id}/export ─────────────────────

@router.get("/login-batch/{batch_id}/export")
async def export_login_results(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export successful logins as action-ready CSV for batch mode."""
    from app.models.fb_login_batch import FBLoginBatch
    from app.models.fb_login_result import FBLoginResult

    # Verify ownership
    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == batch_id,
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Login batch not found")

    # Fetch successful results
    result = await db.execute(
        select(FBLoginResult)
        .where(
            FBLoginResult.login_batch_id == batch_id,
            FBLoginResult.status == "success",
        )
        .order_by(FBLoginResult.created_at)
    )
    results = result.scalars().all()

    if not results:
        raise HTTPException(status_code=400, detail="No successful logins to export")

    meta = MetaAPIService()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)

    for r in results:
        try:
            cookie_str = meta.decrypt_token(r.cookie_encrypted)
        except Exception:
            continue

        proxy_host = ""
        proxy_port = ""
        proxy_user = ""
        proxy_pass = ""
        if r.proxy_used and isinstance(r.proxy_used, dict):
            proxy_host = r.proxy_used.get("host", "")
            proxy_port = r.proxy_used.get("port", "")
            proxy_user = r.proxy_used.get("username", "")
            proxy_pass = r.proxy_used.get("password", "")

        writer.writerow([
            cookie_str,            # cookie
            r.user_agent or "",    # user_agent
            "",                    # action_name (user fills)
            "1",                   # repeat_count
            "", "", "", "", "", "",  # input, content, images, image, video_url, preset_id
            "", "", "", "", "",    # page_id, group_id, post_id, comment_id, parent_post_id
            "", "", "", "", "",    # first, last, middle, bio, uid
            proxy_host, proxy_port, proxy_user, proxy_pass,
        ])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=login_{str(batch_id)[:8]}_action_ready.csv"},
    )


# ── AI Action Planner Endpoints ──────────────────────────────────────

# ── GET /fb-action/ai-plan/login-batches ─────────────────────────────

@router.get("/ai-plan/login-batches")
async def ai_plan_login_batches(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List recent completed login batches for auto-merge dropdown."""
    from app.models.fb_login_batch import FBLoginBatch

    result = await db.execute(
        select(FBLoginBatch)
        .where(
            FBLoginBatch.tenant_id == user.tenant_id,
            FBLoginBatch.status == "completed",
            FBLoginBatch.success_count > 0,
        )
        .order_by(FBLoginBatch.created_at.desc())
        .limit(10)
    )
    batches = result.scalars().all()
    return {
        "items": [
            {
                "id": str(b.id),
                "success_count": b.success_count,
                "total_rows": b.total_rows,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in batches
        ]
    }


# ── POST /fb-action/ai-plan/generate ────────────────────────────────

@router.post("/ai-plan/generate")
async def ai_plan_generate(
    req: AIPlanGenerateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate AI-planned actions from selected posts."""
    from app.models.job import ExtractedComment, ScrapingJob
    from app.services.ai_action_planner import AIActionPlanner, PLANNABLE_ACTIONS

    # Validate action types
    valid_types = [t for t in req.action_types if t in PLANNABLE_ACTIONS]
    if not valid_types:
        raise HTTPException(status_code=400, detail="No valid action types selected")

    if len(req.posts) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 posts per generation")

    # Convert Pydantic models to dicts
    posts_data = [p.model_dump() for p in req.posts]

    # Fetch comments for selected posts if needed
    comments_by_post: dict[str, list[dict]] = {}
    needs_comments = req.include_comments and any(
        t in valid_types for t in ["reply_to_comment", "add_friend"]
    )

    if needs_comments:
        post_ids = [p.post_id for p in req.posts]
        # Find comments from tenant's scraping jobs
        result = await db.execute(
            select(ExtractedComment)
            .join(ScrapingJob, ExtractedComment.job_id == ScrapingJob.id)
            .where(
                ScrapingJob.tenant_id == user.tenant_id,
                ExtractedComment.post_id.in_(post_ids),
            )
            .order_by(ExtractedComment.comment_time.desc())
            .limit(200)  # cap total
        )
        comments = result.scalars().all()
        for c in comments:
            pid = c.post_id
            if pid not in comments_by_post:
                comments_by_post[pid] = []
            if len(comments_by_post[pid]) < 10:  # max 10 per post
                comments_by_post[pid].append({
                    "comment_id": c.comment_id,
                    "commenter_user_id": c.commenter_user_id or "",
                    "commenter_name": c.commenter_name or "",
                    "comment_text": c.comment_text or "",
                })

        # For posts with no DB comments, fetch live from AKNG
        missing_ids = [pid for pid in post_ids if pid not in comments_by_post]
        if missing_ids:
            client = FacebookGraphClient()
            try:
                for pid in missing_ids[:20]:
                    try:
                        raw = await client.get_post_comments(pid, limit=25)
                        data = raw
                        if isinstance(data, dict) and "success" in data:
                            data = data.get("data", data)
                        # Extract comments from field expansion response
                        if isinstance(data, dict):
                            comments_obj = data.get("comments", data)
                            if isinstance(comments_obj, dict):
                                comment_list = comments_obj.get("data", [])
                            else:
                                comment_list = data.get("data", [])
                        else:
                            comment_list = []
                        if not isinstance(comment_list, list):
                            continue
                        comments_by_post[pid] = []
                        for cm in comment_list[:10]:
                            cid = cm.get("id", "")
                            msg = cm.get("message", "")
                            from_data = cm.get("from", {})
                            if cid and msg:
                                comments_by_post[pid].append({
                                    "comment_id": cid,
                                    "commenter_user_id": from_data.get("id", ""),
                                    "commenter_name": from_data.get("name", ""),
                                    "comment_text": msg,
                                })
                    except Exception as exc:
                        logger.warning(f"[AIPlanner] Live comment fetch for {pid}: {exc}")
            finally:
                await client.close()

    try:
        planner = AIActionPlanner()
        actions = await planner.generate_actions(
            posts=posts_data,
            comments_by_post=comments_by_post,
            action_types=valid_types,
            business_context=req.business_context,
            actions_per_post=req.actions_per_post,
            page_id=req.page_id,
            group_id=req.group_id,
        )

        # Charge 2 credits for AI plan generation
        credits_used = 0
        if actions:
            credits_used = 2
            balance_r = await db.execute(
                select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
            )
            balance = balance_r.scalar_one_or_none()
            if balance and balance.balance >= credits_used:
                balance.balance -= credits_used
                balance.lifetime_used += credits_used
                db.add(CreditTransaction(
                    tenant_id=user.tenant_id,
                    user_id=user.id,
                    type="usage",
                    amount=-credits_used,
                    balance_after=balance.balance,
                    description=f"AI Plan: {len(actions)} actions for {len(posts_data)} posts",
                    reference_type="ai_plan_generate",
                ))
                await db.commit()

        return {"actions": actions, "total": len(actions), "credits_used": credits_used}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("AI plan generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"AI generation failed: {str(e)}")


# ── POST /fb-action/ai-plan/export-csv ───────────────────────────────

@router.post("/ai-plan/export-csv")
async def ai_plan_export_csv(
    req: AIPlanExportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export AI-planned actions as a batch-ready CSV, optionally merged with login cookies."""
    from app.models.fb_login_batch import FBLoginBatch
    from app.models.fb_login_result import FBLoginResult
    from app.services.ai_action_planner import AIActionPlanner

    if not req.actions:
        raise HTTPException(status_code=400, detail="No actions to export")

    if len(req.actions) > 500:
        raise HTTPException(status_code=400, detail="Maximum 500 actions per export")

    login_results = None
    meta = MetaAPIService()

    if req.login_batch_id:
        # Verify batch ownership
        batch_result = await db.execute(
            select(FBLoginBatch).where(
                FBLoginBatch.id == req.login_batch_id,
                FBLoginBatch.tenant_id == user.tenant_id,
            )
        )
        batch = batch_result.scalar_one_or_none()
        if not batch:
            raise HTTPException(status_code=404, detail="Login batch not found")

        # Fetch successful results
        results_query = await db.execute(
            select(FBLoginResult)
            .where(
                FBLoginResult.login_batch_id == req.login_batch_id,
                FBLoginResult.status == "success",
            )
            .order_by(FBLoginResult.created_at)
        )
        login_results = list(results_query.scalars().all())
        if not login_results:
            raise HTTPException(status_code=400, detail="No successful logins in this batch")

    planner = AIActionPlanner()
    rows = planner.build_csv_rows(
        actions=req.actions,
        login_results=login_results,
        meta_service=meta,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow([row.get(col, "") for col in CSV_COLUMNS])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=ai_plan_actions.csv"},
    )


# ── POST /fb-action/ai-plan/search-pages ─────────────────────────────


class AISearchPagesRequest(BaseModel):
    prompt: str = ""
    keywords: list[str] | None = None  # Direct keywords — skip AI extraction
    limit_per_keyword: int = 10
    exclude_ids: list[str] | None = None  # Already-loaded page IDs to skip


@router.post("/ai-plan/search-pages")
async def ai_search_pages(
    body: AISearchPagesRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI-powered page discovery: extract keywords -> search AKNG -> deduplicated pages."""
    from app.services.ai_action_planner import AIActionPlanner

    # Use provided keywords or extract from prompt via AI
    used_ai = False
    if body.keywords:
        keywords = body.keywords
    elif body.prompt.strip():
        planner = AIActionPlanner()
        keywords = await planner.extract_search_keywords(body.prompt)
        used_ai = True
    else:
        raise HTTPException(status_code=400, detail="Provide prompt or keywords")

    client = FacebookGraphClient()
    try:
        seen_ids: set[str] = set(body.exclude_ids or [])
        pages: list[dict] = []
        for kw in keywords:
            try:
                raw = await client.search_pages(kw, limit=body.limit_per_keyword)
                # AKNG wraps: {"success": true, "data": {"data": [...]}}
                data = raw
                if isinstance(data, dict) and "success" in data:
                    data = data.get("data", data)
                if isinstance(data, dict):
                    data = data.get("data", [])
                if not isinstance(data, list):
                    continue
                for p in data:
                    pid = p.get("id")
                    if pid and pid not in seen_ids:
                        seen_ids.add(pid)
                        loc = p.get("location")
                        location_str = ""
                        if isinstance(loc, dict):
                            parts = [loc.get("city", ""), loc.get("country", "")]
                            location_str = ", ".join(x for x in parts if x)
                        pages.append({
                            "id": pid,
                            "name": p.get("name", ""),
                            "link": p.get("link", f"https://facebook.com/{pid}"),
                            "location": location_str,
                            "verification_status": p.get("verification_status", ""),
                            "matched_keyword": kw,
                        })
            except Exception as exc:
                logger.warning(f"[AISearch] Search failed for keyword '{kw}': {exc}")
                continue

        # Charge 1 credit for AI-powered search (only when AI was used for keyword extraction)
        credits_used = 0
        if used_ai and pages:
            credits_used = 1
            balance_r = await db.execute(
                select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id)
            )
            balance = balance_r.scalar_one_or_none()
            if balance and balance.balance >= credits_used:
                balance.balance -= credits_used
                balance.lifetime_used += credits_used
                db.add(CreditTransaction(
                    tenant_id=user.tenant_id,
                    user_id=user.id,
                    type="usage",
                    amount=-credits_used,
                    balance_after=balance.balance,
                    description=f"AI Search: {len(keywords)} keywords, {len(pages)} pages found",
                    reference_type="ai_search",
                ))
                await db.commit()

        return {"keywords": keywords, "pages": pages, "total": len(pages), "credits_used": credits_used}
    finally:
        await client.close()


# ═══════════════════════════════════════════════════════════════════════
# LIVESTREAM ENGAGEMENT
# ═══════════════════════════════════════════════════════════════════════


class LiveEngageStartRequest(BaseModel):
    post_id: str
    post_url: str | None = None
    title: str | None = None
    login_batch_id: str
    role_distribution: dict[str, int]
    business_context: str = ""
    training_comments: str | None = None
    ai_instructions: str = ""
    min_delay_seconds: int = Field(default=15, ge=5, le=120)
    max_delay_seconds: int = Field(default=60, ge=10, le=300)


@router.post("/live-engage/start")
async def live_engage_start(
    req: LiveEngageStartRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a livestream engagement session with bulk accounts."""
    from app.models.fb_login_batch import FBLoginBatch

    # Validate role distribution
    if not req.role_distribution:
        raise HTTPException(status_code=400, detail="role_distribution is required")
    invalid_roles = set(req.role_distribution.keys()) - VALID_ROLES
    if invalid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid roles: {invalid_roles}")
    total_pct = sum(req.role_distribution.values())
    if total_pct != 100:
        raise HTTPException(status_code=400, detail=f"Role percentages must sum to 100, got {total_pct}")

    # Validate delays
    if req.max_delay_seconds < req.min_delay_seconds:
        raise HTTPException(status_code=400, detail="max_delay must be >= min_delay")

    # Verify login batch
    batch_result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == req.login_batch_id,
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    batch = batch_result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Login batch not found")
    if (batch.success_count or 0) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 successful login accounts")

    # Resolve post_id from URL if provided
    post_id = req.post_id.strip()
    if req.post_url and not post_id:
        client = FacebookGraphClient()
        parsed = client.parse_post_url(req.post_url.strip())
        post_id = parsed.get("post_id", req.post_url.strip())
        await client.close()

    session = FBLiveEngageSession(
        tenant_id=user.tenant_id,
        user_id=user.id,
        login_batch_id=batch.id,
        post_id=post_id,
        post_url=req.post_url,
        title=req.title,
        role_distribution=req.role_distribution,
        business_context=req.business_context,
        training_comments=req.training_comments,
        ai_instructions=req.ai_instructions,
        min_delay_seconds=req.min_delay_seconds,
        max_delay_seconds=req.max_delay_seconds,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Dispatch Celery task
    from app.scraping.fb_live_engage_tasks import run_live_engagement
    task = run_live_engagement.delay(str(session.id))
    session.celery_task_id = task.id
    await db.commit()

    return {
        "id": str(session.id),
        "status": session.status,
        "post_id": session.post_id,
        "active_accounts": 0,
        "celery_task_id": task.id,
    }


@router.get("/live-engage/{session_id}")
async def live_engage_status(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get livestream engagement session status with activity logs."""
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == session_id,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Fetch last 30 logs
    logs_result = await db.execute(
        select(FBLiveEngageLog)
        .where(FBLiveEngageLog.session_id == session.id)
        .order_by(FBLiveEngageLog.created_at.desc())
        .limit(30)
    )
    logs = logs_result.scalars().all()

    return {
        "id": str(session.id),
        "status": session.status,
        "post_id": session.post_id,
        "post_url": session.post_url,
        "title": session.title,
        "role_distribution": session.role_distribution,
        "total_comments_posted": session.total_comments_posted,
        "total_errors": session.total_errors,
        "comments_by_role": session.comments_by_role,
        "comments_monitored": session.comments_monitored,
        "active_accounts": session.active_accounts,
        "min_delay_seconds": session.min_delay_seconds,
        "max_delay_seconds": session.max_delay_seconds,
        "error_message": session.error_message,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "logs": [
            {
                "id": str(log.id),
                "role": log.role,
                "content": log.content,
                "account_email": log.account_email,
                "reference_comment": log.reference_comment,
                "status": log.status,
                "error_message": log.error_message,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }


@router.post("/live-engage/{session_id}/stop")
async def live_engage_stop(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stop a running livestream engagement session."""
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == session_id,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "running":
        raise HTTPException(status_code=400, detail=f"Session is not running (status: {session.status})")

    session.status = "stopped"
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()

    return {"id": str(session.id), "status": "stopped"}


@router.get("/live-engage/history")
async def live_engage_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List livestream engagement sessions (most recent first)."""
    offset = (page - 1) * page_size

    count_result = await db.execute(
        select(func.count(FBLiveEngageSession.id)).where(
            FBLiveEngageSession.tenant_id == user.tenant_id
        )
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(FBLiveEngageSession)
        .where(FBLiveEngageSession.tenant_id == user.tenant_id)
        .order_by(FBLiveEngageSession.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    sessions = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "sessions": [
            {
                "id": str(s.id),
                "status": s.status,
                "post_id": s.post_id,
                "title": s.title,
                "total_comments_posted": s.total_comments_posted,
                "total_errors": s.total_errors,
                "active_accounts": s.active_accounts,
                "comments_monitored": s.comments_monitored,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in sessions
        ],
    }
