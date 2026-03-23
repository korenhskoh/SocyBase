"""Facebook Action Blaster API — execute FB actions via AKNG fb_action endpoint."""

import csv
import io
import json
import logging
import random
import re
from datetime import datetime, timezone
import uuid
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.credit import CreditBalance, CreditTransaction
from app.models.fb_action_batch import FBActionBatch
from app.models.fb_action_log import FBActionLog
from app.models.fb_cookie_session import FBCookieSession
from app.models.fb_live_engage import FBLiveEngageSession, FBLiveEngageLog, VALID_ROLES, DEFAULT_ROLE_DISTRIBUTION
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


class ConnectCookiesRequest(BaseModel):
    c_user: str = Field(..., min_length=1)
    xs: str = Field(..., min_length=1)
    user_agent: str | None = None


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

    # Use provided UA or fall back to stored one, with sensible default
    DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    ua = body.user_agent or session.user_agent or DEFAULT_UA

    # Proxy config
    proxy_dict = None
    if body.proxy and body.proxy.host:
        proxy_dict = body.proxy.model_dump()

    # Execute via AKNG API
    logger.info("Executing %s: cookie_len=%d, ua_len=%d, proxy=%s",
                body.action_name, len(cookie_str), len(ua), bool(proxy_dict))
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

    result_url = _build_result_url(body.action_name, resp, body.params)
    return {
        "success": log_status == "success",
        "status_code": status_code,
        "status_message": status_msg,
        "data": data.get("data") if isinstance(data, dict) else None,
        "result_url": result_url,
        "raw": resp,
    }


# ── Result URL builder ───────────────────────────────────────────────

POST_ACTIONS = {"post_to_my_feed", "page_post_to_feed", "post_to_group", "post_reels"}
COMMENT_ACTIONS = {"comment_to_post", "page_comment_to_post", "reply_to_comment"}


def _build_result_url(action_name: str, response_data: dict | None, action_params: dict | None) -> str | None:
    """Construct a Facebook URL from action response data."""
    if not response_data or not isinstance(response_data, dict):
        return None
    data = response_data.get("data", {})
    if not isinstance(data, dict):
        return None
    result = data.get("data", {})
    if not isinstance(result, dict):
        return None

    params = action_params or {}

    # Post actions → facebook.com/{post_id}
    post_id = result.get("post_id") or result.get("id")
    if post_id and action_name in POST_ACTIONS:
        return f"https://facebook.com/{post_id}"

    # Comment actions → facebook.com/{post_id}?comment_id={comment_id}
    comment_id = result.get("comment_id")
    if comment_id and action_name in COMMENT_ACTIONS:
        parent = params.get("post_id") or params.get("parent_post_id") or params.get("input", "")
        if parent:
            return f"https://facebook.com/{parent}?comment_id={comment_id}"
        return None

    # get_id → facebook.com/{id}
    if action_name == "get_id" and result.get("id"):
        return f"https://facebook.com/{result['id']}"

    # add_friend → facebook.com/{uid}
    uid = params.get("uid") or result.get("uid")
    if action_name == "add_friend" and uid:
        return f"https://facebook.com/{uid}"

    # join_group → facebook.com/groups/{group_id}
    group_id = params.get("group_id")
    if action_name == "join_group" and group_id:
        return f"https://facebook.com/groups/{group_id}"

    return None


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
                "result_url": _build_result_url(log.action_name, log.response_data, log.action_params),
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
    """Get current FB Action Blaster config (cookie status, UA, proxy)."""
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


# ── POST /fb-action/connect-cookies ─────────────────────────────────

@router.post("/connect-cookies")
async def connect_cookies(
    body: ConnectCookiesRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Connect an account using c_user + xs cookie values."""
    meta = MetaAPIService()

    cookies = [
        {"name": "c_user", "value": body.c_user, "domain": ".facebook.com", "path": "/"},
        {"name": "xs", "value": body.xs, "domain": ".facebook.com", "path": "/"},
    ]

    encrypted = meta.encrypt_token(json.dumps(cookies))

    result = await db.execute(
        select(FBCookieSession).where(FBCookieSession.tenant_id == user.tenant_id)
    )
    session = result.scalar_one_or_none()

    if session:
        session.cookies_encrypted = encrypted
        session.fb_user_id = body.c_user
        session.user_id = user.id
        session.is_valid = True
        session.last_validated_at = None
        if body.user_agent:
            session.user_agent = body.user_agent
    else:
        session = FBCookieSession(
            tenant_id=user.tenant_id,
            user_id=user.id,
            cookies_encrypted=encrypted,
            fb_user_id=body.c_user,
            user_agent=body.user_agent,
        )
        db.add(session)

    await db.commit()
    logger.info("Manual cookie connect for tenant %s (c_user=%s)", user.tenant_id, body.c_user)
    return {"success": True, "fb_user_id": body.c_user}


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


# ── POST /fb-action/batch/ai-generate-params ──────────────────────

@router.post("/batch/ai-generate-params")
async def batch_ai_generate_params(
    data: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI-generate parameters for batch actions. Charges 2 credits."""
    from openai import AsyncOpenAI
    from app.config import get_settings
    import asyncio as aio

    actions = data.get("actions", [])
    if not actions:
        raise HTTPException(status_code=400, detail="Select at least one action")

    # Charge 2 credits for AI generation
    from app.models.credit import CreditTransaction
    balance_result = await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount), 0)).where(
            CreditTransaction.tenant_id == user.tenant_id
        )
    )
    balance = balance_result.scalar() or 0
    if balance < 2:
        raise HTTPException(status_code=402, detail="Insufficient credits (need 2)")
    new_balance = balance - 2
    db.add(CreditTransaction(
        tenant_id=user.tenant_id,
        user_id=user.id,
        type="usage",
        amount=-2,
        balance_after=new_balance,
        description=f"AI batch param generation ({len(actions)} actions)",
        reference_type="ai_batch_params",
    ))
    await db.commit()

    settings = get_settings()
    openai_client = AsyncOpenAI(api_key=settings.openai_api_key)

    account_count = min(data.get("account_count", 1), 50)
    prompt = data.get("prompt", "Generate natural, varied parameters")

    action_schema = {
        "change_name": {"fields": ["first", "last"], "desc": "Generate realistic full names"},
        "change_bio": {"fields": ["bio"], "desc": "Generate short, natural bios (max 101 chars)"},
        "change_avatar": {"fields": ["image"], "desc": "NOT generated — user must provide image URLs"},
        "post_to_my_feed": {"fields": ["content"], "desc": "Generate varied social media posts"},
        "comment_to_post": {"fields": ["content"], "desc": "Generate natural comments"},
        "post_to_group": {"fields": ["content"], "desc": "Generate group post content"},
        "page_post_to_feed": {"fields": ["content"], "desc": "Generate page post content"},
        "add_friend": {"fields": ["uid"], "desc": "NOT generated — user must provide user IDs"},
        "join_group": {"fields": ["group_id"], "desc": "NOT generated — user must provide group IDs"},
    }

    n = min(account_count, 30)
    system_prompt = f"""Generate parameters for Facebook batch actions.
User instruction: {prompt}
Number of accounts: {n}

IMPORTANT: For EACH field, return an ARRAY of {n} values (one per account).
Each value must be unique and varied.

Return JSON:
{{
  "params": {{
    "action_name": {{
      "field_name": ["value1", "value2", "value3", ...]
    }}
  }}
}}

Actions to generate for:
"""
    for action in actions:
        schema = action_schema.get(action, {})
        if schema:
            system_prompt += f"\n- {action}: fields={schema['fields']}, {schema['desc']}"

    try:
        resp = await aio.wait_for(
            openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Generate {n} unique variations for each field."},
                ],
                temperature=0.7, max_tokens=4000,
                response_format={"type": "json_object"},
            ),
            timeout=45,
        )
        content = resp.choices[0].message.content or "{}"
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            result = {}

        # Ensure all values are arrays
        params = result.get("params", {})
        for action_key, fields in params.items():
            if isinstance(fields, dict):
                for field_key, val in fields.items():
                    if not isinstance(val, list):
                        fields[field_key] = [val] * n

        return {"params": params, "count": n}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(exc)[:200]}")


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
    writer.writerow(["#", "Action", "Status", "Error", "Response Summary", "Result Link", "Time"])
    for i, log in enumerate(logs, 1):
        # Build a short response summary
        summary = ""
        if log.response_data and isinstance(log.response_data, dict):
            data = log.response_data.get("data", {})
            if isinstance(data, dict):
                inner = data.get("data", {})
                if isinstance(inner, dict):
                    summary = "; ".join(f"{k}={v}" for k, v in inner.items())

        result_url = _build_result_url(log.action_name, log.response_data, log.action_params) or ""

        writer.writerow([
            i,
            log.action_name,
            log.status,
            log.error_message or "",
            summary,
            result_url,
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


# ── GET /fb-action/login-batch/system-info ────────────────────────────

@router.get("/login-batch/system-info")
async def get_login_system_info(user: User = Depends(get_current_user)):
    """Return server RAM info and recommended concurrency for browser-based login."""
    import psutil
    mem = psutil.virtual_memory()
    total_mb = int(mem.total / (1024 * 1024))
    available_mb = int(mem.available / (1024 * 1024))
    # Reserve 500MB for OS + app, ~150MB per Chromium instance
    recommended = max(1, min(20, (available_mb - 500) // 150))
    return {
        "total_ram_mb": total_mb,
        "available_ram_mb": available_mb,
        "recommended_parallel": recommended,
        "max_parallel": 20,
    }


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
    max_parallel = max(1, min(20, int(batch_settings.get("max_parallel", 2))))

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

    # NOTE: Login runs on user's local machine via worker script (not Celery).
    # Batch stays "pending" until the local worker starts processing.

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
    from app.models.fb_login_result import FBLoginResult

    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == batch_id,
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Login batch not found")

    # Include per-account results when batch is done
    results_list = []
    if batch.status in ("completed", "failed", "cancelled"):
        res = await db.execute(
            select(FBLoginResult)
            .where(FBLoginResult.login_batch_id == batch_id)
            .order_by(FBLoginResult.created_at)
        )
        for r in res.scalars().all():
            results_list.append({
                "email": r.email,
                "status": r.status,
                "fb_user_id": r.fb_user_id,
                "error_message": r.error_message,
                "has_token": bool(r.access_token_encrypted),
            })

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
        "results": results_list,
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
    writer.writerow(CSV_COLUMNS + ["access_token"])

    for r in results:
        try:
            cookie_str = meta.decrypt_token(r.cookie_encrypted)
        except Exception:
            continue

        access_token = ""
        if r.access_token_encrypted:
            try:
                access_token = meta.decrypt_token(r.access_token_encrypted)
            except Exception:
                pass

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
            "", "", "", "",        # first, last, middle, bio
            r.fb_user_id or "",    # uid
            proxy_host, proxy_port, proxy_user, proxy_pass,
            access_token,          # access_token
        ])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=login_{str(batch_id)[:8]}_action_ready.csv"},
    )


# ── Local Worker Endpoints (login runs on user's machine) ────────────

@router.get("/login-batch/{batch_id}/worker-data")
async def get_worker_data(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return decrypted account data for the local worker script."""
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
    if not batch.csv_data_encrypted:
        raise HTTPException(status_code=400, detail="Batch data already cleared or processed")

    meta = MetaAPIService()
    rows = json.loads(meta.decrypt_token(batch.csv_data_encrypted))

    return {
        "batch_id": str(batch.id),
        "accounts": rows,
        "execution_mode": batch.execution_mode,
        "delay_seconds": batch.delay_seconds,
        "max_parallel": batch.max_parallel,
        "proxy_pool": batch.proxy_pool or [],
    }


@router.post("/login-batch/{batch_id}/worker-start")
async def worker_start_batch(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark batch as running (called by local worker)."""
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

    batch.status = "running"
    batch.started_at = datetime.now(timezone.utc)
    await db.commit()
    return {"success": True}


class WorkerResultPayload(BaseModel):
    email: str
    success: bool
    cookie_string: str | None = None
    fb_user_id: str | None = None
    user_agent: str | None = None
    error: str | None = None
    proxy_used: dict | None = None
    access_token: str | None = None


@router.post("/login-batch/{batch_id}/worker-result")
async def post_worker_result(
    batch_id: UUID,
    payload: WorkerResultPayload,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Receive a single login result from the local worker."""
    from app.models.fb_login_batch import FBLoginBatch
    from app.models.fb_login_result import FBLoginResult

    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == batch_id,
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Login batch not found")

    meta = MetaAPIService()

    if payload.success and payload.cookie_string:
        encrypted_cookie = meta.encrypt_token(payload.cookie_string)
        encrypted_token = meta.encrypt_token(payload.access_token) if payload.access_token else None
        log = FBLoginResult(
            login_batch_id=batch.id, tenant_id=user.tenant_id, user_id=user.id,
            email=payload.email, fb_user_id=payload.fb_user_id,
            cookie_encrypted=encrypted_cookie, access_token_encrypted=encrypted_token,
            user_agent=payload.user_agent,
            proxy_used=payload.proxy_used, status="success",
        )
        db.add(log)
        batch.success_count += 1
    else:
        log = FBLoginResult(
            login_batch_id=batch.id, tenant_id=user.tenant_id, user_id=user.id,
            email=payload.email, user_agent=payload.user_agent,
            proxy_used=payload.proxy_used, status="failed",
            error_message=payload.error,
        )
        db.add(log)
        batch.failed_count += 1

    batch.completed_rows += 1
    await db.commit()
    return {"success": True}


@router.post("/login-batch/{batch_id}/worker-complete")
async def worker_complete_batch(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark batch as completed (called by local worker when done)."""
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

    if batch.failed_count == batch.total_rows:
        batch.status = "failed"
    else:
        batch.status = "completed"
    batch.completed_at = datetime.now(timezone.utc)
    batch.csv_data_encrypted = None  # clear sensitive data
    await db.commit()
    return {"success": True}


@router.get("/login-batch/worker-script")
async def download_worker_script(_user: User = Depends(get_current_user)):
    """Download the local login worker Python script."""
    import pathlib
    # Try multiple possible locations (local dev vs Docker)
    base = pathlib.Path(__file__).resolve().parent
    candidates = [
        base.parent.parent.parent / "scripts" / "fb_login_worker.py",  # from app/api/v1/ -> backend/
        pathlib.Path("/app/scripts/fb_login_worker.py"),                # Docker WORKDIR
    ]
    content = None
    for p in candidates:
        if p.exists():
            content = p.read_text(encoding="utf-8")
            break
    if content is None:
        raise HTTPException(status_code=404, detail="Worker script not found")
    return Response(
        content=content,
        media_type="text/x-python",
        headers={"Content-Disposition": 'attachment; filename="fb_login_worker.py"'},
    )


# ══════════════════════════════════════════════════════════════════════
# Warm-Up Batch — browser-based warm-up via Chrome extension
# ══════════════════════════════════════════════════════════════════════

WARMUP_PRESETS = {
    "light": {
        "label": "Light",
        "actions": [
            {"type": "scroll_feed", "count": 3, "min_delay": 2, "max_delay": 5},
            {"type": "pause", "min_delay": 5, "max_delay": 10},
            {"type": "watch_videos", "count": 1, "min_delay": 10, "max_delay": 20},
            {"type": "pause", "min_delay": 3, "max_delay": 8},
        ],
    },
    "medium": {
        "label": "Medium",
        "actions": [
            {"type": "scroll_feed", "count": 5, "min_delay": 2, "max_delay": 5},
            {"type": "like_posts", "count": 2, "min_delay": 3, "max_delay": 6},
            {"type": "watch_videos", "count": 1, "min_delay": 10, "max_delay": 25},
            {"type": "view_stories", "count": 1, "min_delay": 4, "max_delay": 8},
            {"type": "scroll_feed", "count": 3, "min_delay": 2, "max_delay": 4},
            {"type": "check_notifications", "min_delay": 3, "max_delay": 6},
        ],
    },
    "heavy": {
        "label": "Heavy",
        "actions": [
            {"type": "scroll_feed", "count": 8, "min_delay": 2, "max_delay": 5},
            {"type": "react_posts", "count": 2, "min_delay": 3, "max_delay": 6},
            {"type": "like_posts", "count": 2, "min_delay": 3, "max_delay": 6},
            {"type": "watch_videos", "count": 2, "min_delay": 10, "max_delay": 30},
            {"type": "view_stories", "count": 2, "min_delay": 4, "max_delay": 8},
            {"type": "browse_marketplace", "min_delay": 8, "max_delay": 15},
            {"type": "view_profiles", "count": 1, "min_delay": 5, "max_delay": 10},
            {"type": "scroll_feed", "count": 5, "min_delay": 2, "max_delay": 4},
            {"type": "search_feed", "min_delay": 5, "max_delay": 10},
            {"type": "comment_posts", "count": 1, "min_delay": 4, "max_delay": 8},
            {"type": "check_notifications", "min_delay": 3, "max_delay": 6},
        ],
    },
}


class WarmupBatchRequest(BaseModel):
    login_batch_id: str
    preset: str = "light"
    delay_seconds: float = Field(10.0, ge=3, le=60)
    scheduled_at: str | None = None


@router.post("/warmup-batch")
async def create_warmup_batch(
    body: WarmupBatchRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a warm-up batch from a login batch's successful accounts."""
    from app.models.fb_warmup_batch import FBWarmupBatch
    from app.models.fb_login_batch import FBLoginBatch
    from app.models.fb_login_result import FBLoginResult

    if body.preset not in WARMUP_PRESETS:
        raise HTTPException(status_code=400, detail=f"Invalid preset. Use: {', '.join(WARMUP_PRESETS)}")

    # Verify login batch
    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == UUID(body.login_batch_id),
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    login_batch = result.scalar_one_or_none()
    if not login_batch:
        raise HTTPException(status_code=404, detail="Login batch not found")

    # Count successful logins
    count_q = select(func.count(FBLoginResult.id)).where(
        FBLoginResult.login_batch_id == UUID(body.login_batch_id),
        FBLoginResult.status == "success",
    )
    account_count = (await db.execute(count_q)).scalar() or 0
    if account_count == 0:
        raise HTTPException(status_code=400, detail="No successful logins in this batch")

    # Parse scheduled_at if provided
    sched_dt = None
    if body.scheduled_at:
        try:
            sched_dt = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid scheduled_at datetime format")

    warmup = FBWarmupBatch(
        tenant_id=user.tenant_id,
        user_id=user.id,
        login_batch_id=UUID(body.login_batch_id),
        status="scheduled" if sched_dt else "pending",
        preset=body.preset,
        total_accounts=account_count,
        delay_seconds=body.delay_seconds,
        config=WARMUP_PRESETS[body.preset],
        scheduled_at=sched_dt,
    )
    db.add(warmup)
    await db.commit()
    await db.refresh(warmup)

    return {
        "id": str(warmup.id),
        "status": warmup.status,
        "preset": warmup.preset,
        "total_accounts": warmup.total_accounts,
        "delay_seconds": warmup.delay_seconds,
        "scheduled_at": warmup.scheduled_at.isoformat() if warmup.scheduled_at else None,
    }


@router.get("/warmup-batch/{batch_id}")
async def get_warmup_batch(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get warm-up batch status."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    result = await db.execute(
        select(FBWarmupBatch).where(
            FBWarmupBatch.id == batch_id,
            FBWarmupBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Warm-up batch not found")

    return {
        "id": str(batch.id),
        "login_batch_id": str(batch.login_batch_id),
        "status": batch.status,
        "preset": batch.preset,
        "total_accounts": batch.total_accounts,
        "completed_accounts": batch.completed_accounts,
        "success_count": batch.success_count,
        "failed_count": batch.failed_count,
        "delay_seconds": batch.delay_seconds,
        "config": batch.config,
        "error_message": batch.error_message,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "started_at": batch.started_at.isoformat() if batch.started_at else None,
        "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
        "scheduled_at": batch.scheduled_at.isoformat() if batch.scheduled_at else None,
    }


@router.get("/warmup-batch/{batch_id}/worker-data")
async def get_warmup_worker_data(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Extension fetches accounts + config for warm-up execution."""
    from app.models.fb_warmup_batch import FBWarmupBatch
    from app.models.fb_login_result import FBLoginResult

    result = await db.execute(
        select(FBWarmupBatch).where(
            FBWarmupBatch.id == batch_id,
            FBWarmupBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Warm-up batch not found")

    # Fetch successful login results
    meta = MetaAPIService()
    results = await db.execute(
        select(FBLoginResult)
        .where(
            FBLoginResult.login_batch_id == batch.login_batch_id,
            FBLoginResult.status == "success",
        )
        .order_by(FBLoginResult.created_at)
    )
    accounts = []
    for r in results.scalars().all():
        try:
            cookie_str = meta.decrypt_token(r.cookie_encrypted)
        except Exception:
            continue
        proxy = r.proxy_used or {}
        accounts.append({
            "email": r.email,
            "fb_user_id": r.fb_user_id,
            "cookie": cookie_str,
            "user_agent": r.user_agent or "",
            "proxy_host": proxy.get("host", ""),
            "proxy_port": proxy.get("port", ""),
            "proxy_username": proxy.get("username", ""),
            "proxy_password": proxy.get("password", ""),
        })

    return {
        "accounts": accounts,
        "preset": batch.preset,
        "config": batch.config,
        "delay_seconds": batch.delay_seconds,
    }


@router.post("/warmup-batch/{batch_id}/worker-start")
async def warmup_worker_start(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark warm-up batch as running."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    result = await db.execute(
        select(FBWarmupBatch).where(
            FBWarmupBatch.id == batch_id,
            FBWarmupBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Warm-up batch not found")
    batch.status = "running"
    batch.started_at = datetime.now(timezone.utc)
    await db.commit()
    return {"success": True}


class WarmupResultPayload(BaseModel):
    email: str
    success: bool
    actions_completed: list[str] = []
    error: str | None = None


@router.post("/warmup-batch/{batch_id}/worker-result")
async def post_warmup_result(
    batch_id: UUID,
    payload: WarmupResultPayload,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Extension reports warm-up result for a single account."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    result = await db.execute(
        select(FBWarmupBatch).where(
            FBWarmupBatch.id == batch_id,
            FBWarmupBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Warm-up batch not found")

    batch.completed_accounts += 1
    if payload.success:
        batch.success_count += 1
    else:
        batch.failed_count += 1
    await db.commit()

    logger.info("[Warmup] %s: %s (%s) — actions: %s",
                payload.email, "OK" if payload.success else "FAIL",
                payload.error or "", ", ".join(payload.actions_completed))
    return {"success": True}


@router.post("/warmup-batch/{batch_id}/worker-complete")
async def warmup_worker_complete(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark warm-up batch as complete."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    result = await db.execute(
        select(FBWarmupBatch).where(
            FBWarmupBatch.id == batch_id,
            FBWarmupBatch.tenant_id == user.tenant_id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Warm-up batch not found")

    if batch.failed_count == batch.total_accounts:
        batch.status = "failed"
    else:
        batch.status = "completed"
    batch.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"success": True}


@router.get("/warmup-batch/history")
async def get_warmup_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
):
    """Get warm-up batch history."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    filters = [FBWarmupBatch.tenant_id == user.tenant_id]
    count_q = select(func.count(FBWarmupBatch.id)).where(*filters)
    total = (await db.execute(count_q)).scalar() or 0

    q = (
        select(FBWarmupBatch)
        .where(*filters)
        .order_by(FBWarmupBatch.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    batches = result.scalars().all()

    return {
        "items": [
            {
                "id": str(b.id),
                "login_batch_id": str(b.login_batch_id),
                "status": b.status,
                "preset": b.preset,
                "total_accounts": b.total_accounts,
                "completed_accounts": b.completed_accounts,
                "success_count": b.success_count,
                "failed_count": b.failed_count,
                "created_at": b.created_at.isoformat() if b.created_at else None,
                "scheduled_at": b.scheduled_at.isoformat() if b.scheduled_at else None,
            }
            for b in batches
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/warmup-batch/scheduled")
async def get_scheduled_warmups(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get pending scheduled warm-ups."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    result = await db.execute(
        select(FBWarmupBatch)
        .where(
            FBWarmupBatch.tenant_id == user.tenant_id,
            FBWarmupBatch.status == "scheduled",
        )
        .order_by(FBWarmupBatch.scheduled_at)
    )
    batches = result.scalars().all()
    return {
        "items": [
            {
                "id": str(b.id),
                "login_batch_id": str(b.login_batch_id),
                "preset": b.preset,
                "total_accounts": b.total_accounts,
                "delay_seconds": b.delay_seconds,
                "scheduled_at": b.scheduled_at.isoformat() if b.scheduled_at else None,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in batches
        ],
    }


@router.delete("/warmup-batch/{batch_id}/cancel-schedule")
async def cancel_scheduled_warmup(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a scheduled warm-up."""
    from app.models.fb_warmup_batch import FBWarmupBatch

    result = await db.execute(
        select(FBWarmupBatch).where(
            FBWarmupBatch.id == batch_id,
            FBWarmupBatch.tenant_id == user.tenant_id,
            FBWarmupBatch.status == "scheduled",
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Scheduled warm-up not found")
    await db.delete(batch)
    await db.commit()
    return {"success": True}


# ── DOM Selector Verification ────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════


class DOMCheckRequest(BaseModel):
    login_batch_id: str


class DOMSnapshotSubmit(BaseModel):
    snapshot: dict
    account_email: str


@router.post("/dom-selectors/check")
async def start_dom_check(
    body: DOMCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pick one account from login batch and return its decrypted cookie for DOM check."""
    from app.models.fb_login_batch import FBLoginBatch
    from app.models.fb_login_result import FBLoginResult

    result = await db.execute(
        select(FBLoginBatch).where(
            FBLoginBatch.id == UUID(body.login_batch_id),
            FBLoginBatch.tenant_id == user.tenant_id,
        )
    )
    login_batch = result.scalar_one_or_none()
    if not login_batch:
        raise HTTPException(status_code=404, detail="Login batch not found")

    # Pick one successful account with cookies
    acct_r = await db.execute(
        select(FBLoginResult)
        .where(
            FBLoginResult.login_batch_id == UUID(body.login_batch_id),
            FBLoginResult.status == "success",
            FBLoginResult.cookie_encrypted.isnot(None),
        )
        .limit(1)
    )
    account = acct_r.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=400, detail="No successful accounts in this batch")

    meta = MetaAPIService()
    try:
        cookie_str = meta.decrypt_token(account.cookie_encrypted)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to decrypt account cookies")

    proxy = account.proxy_used or {}

    return {
        "account_email": account.email,
        "cookie": cookie_str,
        "user_agent": account.user_agent or "",
        "proxy_host": proxy.get("host", ""),
        "proxy_port": proxy.get("port", ""),
        "proxy_username": proxy.get("username", ""),
        "proxy_password": proxy.get("password", ""),
    }


@router.post("/dom-selectors/submit")
async def submit_dom_snapshot(
    body: DOMSnapshotSubmit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Receive DOM snapshot from extension, analyze with AI, store results."""
    from app.models.fb_dom_selector import FBDOMSelector
    from app.services.ai_dom_selector import DOMSelectorVerifier

    if not body.snapshot or not body.snapshot.get("elements"):
        raise HTTPException(status_code=400, detail="Invalid DOM snapshot")

    try:
        verifier = DOMSelectorVerifier()
        result = await verifier.verify_selectors(body.snapshot)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("[DOMSelector] AI verification failed: %s", e)
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    # Deactivate old configs for this tenant
    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(FBDOMSelector)
        .where(FBDOMSelector.tenant_id == user.tenant_id)
        .values(is_active=False)
    )

    selector_config = FBDOMSelector(
        tenant_id=user.tenant_id,
        selectors=result.get("selectors", {}),
        overall_confidence=result.get("overall_confidence", 0.0),
        warnings=result.get("warnings"),
        facebook_version=result.get("facebook_version"),
        verified_by_account=body.account_email,
        raw_snapshot=body.snapshot,
        is_active=True,
    )
    db.add(selector_config)
    await db.commit()
    await db.refresh(selector_config)

    return {
        "success": True,
        "config_id": str(selector_config.id),
        "confidence": result.get("overall_confidence", 0.0),
        "selectors": result.get("selectors", {}),
        "warnings": result.get("warnings", []),
        "facebook_version": result.get("facebook_version"),
    }


@router.get("/dom-selectors/current")
async def get_current_selectors(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get currently active DOM selector config."""
    from app.models.fb_dom_selector import FBDOMSelector

    result = await db.execute(
        select(FBDOMSelector)
        .where(
            FBDOMSelector.tenant_id == user.tenant_id,
            FBDOMSelector.is_active == True,  # noqa: E712
        )
        .order_by(FBDOMSelector.verified_at.desc())
        .limit(1)
    )
    config = result.scalar_one_or_none()

    if not config:
        return {"has_config": False, "selectors": None}

    return {
        "has_config": True,
        "config_id": str(config.id),
        "selectors": config.selectors,
        "confidence": config.overall_confidence,
        "warnings": config.warnings,
        "facebook_version": config.facebook_version,
        "verified_at": config.verified_at.isoformat() if config.verified_at else None,
        "verified_by": config.verified_by_account,
    }


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

        # Auto-save search history (only for prompt-based searches with results)
        if body.prompt.strip() and pages:
            try:
                from app.models.ai_search_history import AISearchHistory
                db.add(AISearchHistory(
                    tenant_id=user.tenant_id,
                    user_id=user.id,
                    prompt=body.prompt.strip(),
                    keywords=keywords,
                    pages=pages,
                    pages_count=len(pages),
                ))
                await db.commit()
            except Exception as exc:
                logger.warning(f"[AISearch] Failed to save search history: {exc}")

        return {"keywords": keywords, "pages": pages, "total": len(pages), "credits_used": credits_used}
    finally:
        await client.close()


# ── GET /fb-action/ai-plan/search-history ──────────────────────────────

@router.get("/ai-plan/search-history")
async def ai_plan_search_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List recent AI search history for retrieval."""
    from app.models.ai_search_history import AISearchHistory

    result = await db.execute(
        select(AISearchHistory)
        .where(AISearchHistory.tenant_id == user.tenant_id)
        .order_by(AISearchHistory.created_at.desc())
        .limit(20)
    )
    items = result.scalars().all()
    return {
        "items": [
            {
                "id": str(h.id),
                "prompt": h.prompt,
                "keywords": h.keywords,
                "pages": h.pages,
                "pages_count": h.pages_count,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in items
        ]
    }


# ── GET /fb-action/ai-plan/my-jobs ────────────────────────────────────

@router.get("/ai-plan/my-jobs")
async def ai_plan_my_jobs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List completed post_discovery jobs for 'My Posts' source tab."""
    from app.models.job import ScrapingJob

    result = await db.execute(
        select(ScrapingJob)
        .where(
            ScrapingJob.tenant_id == user.tenant_id,
            ScrapingJob.job_type == "post_discovery",
            ScrapingJob.status == "completed",
            ScrapingJob.result_row_count > 0,
        )
        .order_by(ScrapingJob.completed_at.desc().nulls_last())
        .limit(50)
    )
    jobs = result.scalars().all()
    return {
        "items": [
            {
                "id": str(j.id),
                "input_value": j.input_value,
                "result_row_count": j.result_row_count,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j in jobs
        ]
    }


# ── POST /fb-action/ai-plan/my-posts ──────────────────────────────────

class MyPostsRequest(BaseModel):
    job_ids: list[str] = Field(..., min_length=1, max_length=20)


@router.post("/ai-plan/my-posts")
async def ai_plan_my_posts(
    req: MyPostsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Load aggregated, deduplicated posts from selected post_discovery jobs."""
    from app.models.job import ScrapedPost, ScrapingJob

    job_uuids = [UUID(jid) for jid in req.job_ids]

    # Verify all jobs belong to tenant
    result = await db.execute(
        select(ScrapingJob.id).where(
            ScrapingJob.id.in_(job_uuids),
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    valid_ids = [r[0] for r in result.all()]
    if not valid_ids:
        raise HTTPException(status_code=404, detail="No valid jobs found")

    # Deduplicate posts by post_id (keep most recent)
    dedup_subq = (
        select(
            ScrapedPost.id,
            func.row_number()
            .over(
                partition_by=ScrapedPost.post_id,
                order_by=ScrapedPost.created_time.desc().nulls_last(),
            )
            .label("rn"),
        )
        .where(ScrapedPost.job_id.in_(valid_ids))
    ).subquery()

    result = await db.execute(
        select(ScrapedPost)
        .join(dedup_subq, ScrapedPost.id == dedup_subq.c.id)
        .where(dedup_subq.c.rn == 1)
        .order_by(ScrapedPost.reaction_count.desc().nulls_last())
        .limit(200)
    )
    posts = result.scalars().all()

    return {
        "items": [
            {
                "post_id": p.post_id,
                "message": p.message,
                "created_time": p.created_time.isoformat() if p.created_time else None,
                "from_name": p.from_name,
                "from_id": getattr(p, "from_id", None),
                "comment_count": p.comment_count or 0,
                "reaction_count": p.reaction_count or 0,
                "share_count": p.share_count or 0,
                "attachment_type": p.attachment_type,
                "post_url": p.post_url,
                "is_livestream": getattr(p, "is_livestream", False),
                "video_views": getattr(p, "video_views", None),
            }
            for p in posts
        ],
        "total": len(posts),
    }


# ═══════════════════════════════════════════════════════════════════════
# LIVESTREAM ENGAGEMENT
# ═══════════════════════════════════════════════════════════════════════


def _parse_scheduled_at(val: str | None) -> datetime | None:
    if not val:
        return None
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


class LiveEngageDirectAccount(BaseModel):
    cookies: str
    email: str  # or phone number
    token: str | None = None
    twofa: str | None = None
    proxy_host: str | None = None
    proxy_port: str | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None
    user_agent: str | None = None


class LiveEngageStartRequest(BaseModel):
    post_id: str
    post_url: str | None = None
    title: str | None = None
    login_batch_id: str | None = None  # from existing login batch
    direct_accounts: list[LiveEngageDirectAccount] | None = None  # from CSV upload
    role_distribution: dict[str, int]
    business_context: str = ""
    training_comments: str | None = None
    ai_instructions: str = ""
    page_owner_id: str | None = None
    scrape_interval_seconds: int = Field(default=8, ge=3, le=30)
    context_window: int = Field(default=50, ge=10, le=200)
    ai_context_count: int = Field(default=15, ge=5, le=50)
    product_codes: str | None = None  # comma-separated seed codes e.g. "m763, E769"
    code_pattern: str | None = None  # custom regex for product code detection
    quantity_variation: bool = True  # add +N quantity to order comments
    aggressive_level: str = "medium"  # low, medium, high
    min_delay_seconds: int = Field(default=15, ge=5, le=120)
    max_delay_seconds: int = Field(default=60, ge=10, le=300)
    max_duration_minutes: int = Field(default=180, ge=10, le=720)
    target_comments_enabled: bool = False
    target_comments_count: int | None = Field(default=None, ge=1, le=5000)
    target_comments_period_minutes: int | None = Field(default=None, ge=5, le=720)
    languages: list[str] | None = None  # e.g. ["chinese", "malay", "english"]
    comment_without_new: bool = False  # generate comments even without new viewer comments
    comment_without_new_max: int = Field(default=3, ge=1, le=20)  # max attempts before waiting
    auto_order_trending: bool = False  # auto place_order when code trends in comments
    auto_order_trending_threshold: int = Field(default=3, ge=2, le=20)  # mentions in 60s to trigger
    auto_order_trending_cooldown: int = Field(default=60, ge=10, le=600)  # seconds between auto-orders
    track_host_product: bool = True  # auto-detect current product from host comments
    blacklist_words: str | None = None  # comma-separated words to avoid
    stream_end_threshold: int = Field(default=0, ge=0, le=50)  # 0 = disabled
    scheduled_at: str | None = None  # ISO datetime for scheduled start


class SmartSetupRequest(BaseModel):
    page_url: str | None = None
    video_url: str | None = None
    max_comments: int = Field(default=200, ge=50, le=500)


@router.post("/live-engage/start")
async def live_engage_start(
    req: LiveEngageStartRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a livestream engagement session with bulk accounts."""
    from app.models.fb_login_batch import FBLoginBatch

    # Auto-cleanup stale sessions (stuck as "running" for >4 hours = zombie)
    stale_cutoff = datetime.now(timezone.utc) - __import__("datetime").timedelta(hours=4)
    stale_result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.tenant_id == user.tenant_id,
            FBLiveEngageSession.status.in_(["running", "paused"]),
            FBLiveEngageSession.started_at < stale_cutoff,
        )
    )
    for stale in stale_result.scalars().all():
        stale.status = "completed"
        stale.ended_at = datetime.now(timezone.utc)
        stale.error_message = "Auto-completed: session was stale (stuck >4h)"
    await db.commit()

    # Check for truly active sessions
    active_result = await db.execute(
        select(func.count(FBLiveEngageSession.id)).where(
            FBLiveEngageSession.tenant_id == user.tenant_id,
            FBLiveEngageSession.status.in_(["running", "paused"]),
        )
    )
    active_count = active_result.scalar() or 0
    if active_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"You already have {active_count} active session(s). Stop or complete them before starting a new one."
        )

    # Validate role distribution
    if not req.role_distribution:
        raise HTTPException(status_code=400, detail="role_distribution is required")
    invalid_roles = set(req.role_distribution.keys()) - VALID_ROLES
    if invalid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid roles: {invalid_roles}")
    if any(v < 0 for v in req.role_distribution.values()):
        raise HTTPException(status_code=400, detail="Role percentages cannot be negative")
    total_pct = sum(req.role_distribution.values())
    if total_pct != 100:
        raise HTTPException(status_code=400, detail=f"Role percentages must sum to 100, got {total_pct}")

    # Validate aggressive level
    if req.aggressive_level not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="aggressive_level must be low, medium, or high")

    # Validate code_pattern if provided
    if req.code_pattern:
        import re
        try:
            re.compile(req.code_pattern)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"Invalid code_pattern regex: {e}")

    # Validate delays
    if req.max_delay_seconds < req.min_delay_seconds:
        raise HTTPException(status_code=400, detail="max_delay must be >= min_delay")

    # Validate account source — must provide either login_batch_id or direct_accounts
    if not req.login_batch_id and not req.direct_accounts:
        raise HTTPException(status_code=400, detail="Provide either login_batch_id or direct_accounts")

    batch_id = None
    # Validate target comments
    if req.target_comments_enabled:
        if not req.target_comments_count or not req.target_comments_period_minutes:
            raise HTTPException(status_code=400, detail="target_comments_count and target_comments_period_minutes required when target mode is enabled")

    direct_accounts_encrypted = None

    if req.login_batch_id:
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
        batch_id = batch.id

    if req.direct_accounts:
        if len(req.direct_accounts) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 accounts")
        if len(req.direct_accounts) > 200:
            raise HTTPException(status_code=400, detail="Max 200 accounts per session")
        # Validate all accounts have cookies
        for i, acct in enumerate(req.direct_accounts):
            if not acct.cookies.strip():
                raise HTTPException(status_code=400, detail=f"Account {i + 1} ({acct.email}): cookies required")
        # Encrypt and store
        import json
        from app.services.meta_api import MetaAPIService
        meta = MetaAPIService()
        accounts_json = json.dumps([a.model_dump() for a in req.direct_accounts])
        direct_accounts_encrypted = meta.encrypt_token(accounts_json)

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
        login_batch_id=batch_id,
        direct_accounts_encrypted=direct_accounts_encrypted,
        post_id=post_id,
        post_url=req.post_url,
        title=req.title,
        role_distribution=req.role_distribution,
        business_context=req.business_context,
        training_comments=req.training_comments,
        ai_instructions=req.ai_instructions,
        page_owner_id=req.page_owner_id,
        scrape_interval_seconds=req.scrape_interval_seconds,
        context_window=req.context_window,
        ai_context_count=req.ai_context_count,
        product_codes=req.product_codes,
        code_pattern=req.code_pattern,
        quantity_variation=req.quantity_variation,
        aggressive_level=req.aggressive_level,
        min_delay_seconds=req.min_delay_seconds,
        max_delay_seconds=req.max_delay_seconds,
        max_duration_minutes=req.max_duration_minutes,
        target_comments_enabled=req.target_comments_enabled,
        target_comments_count=req.target_comments_count,
        target_comments_period_minutes=req.target_comments_period_minutes,
        languages=",".join(req.languages) if req.languages else None,
        comment_without_new=req.comment_without_new,
        comment_without_new_max=req.comment_without_new_max,
        auto_order_trending=req.auto_order_trending,
        auto_order_trending_threshold=req.auto_order_trending_threshold,
        auto_order_trending_cooldown=req.auto_order_trending_cooldown,
        track_host_product=req.track_host_product,
        blacklist_words=req.blacklist_words,
        stream_end_threshold=req.stream_end_threshold,
        scheduled_at=_parse_scheduled_at(req.scheduled_at),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Dispatch Celery task (with optional scheduled start)
    from app.scraping.fb_live_engage_tasks import run_live_engagement
    if session.scheduled_at:
        session.status = "scheduled"
        task = run_live_engagement.apply_async(args=[str(session.id)], eta=session.scheduled_at)
    else:
        task = run_live_engagement.delay(str(session.id))
    session.celery_task_id = task.id
    await db.commit()

    return {
        "id": str(session.id),
        "status": session.status,
        "post_id": session.post_id,
        "active_accounts": 0,
        "celery_task_id": task.id,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
    }


LIVE_ENGAGE_CSV_COLUMNS = ["cookies", "email", "token", "twofa", "proxy_host", "proxy_port", "proxy_username", "proxy_password", "user_agent"]


@router.get("/live-engage/accounts-template")
async def live_engage_accounts_template():
    """Download CSV template for direct account upload."""
    import csv
    import io
    from fastapi.responses import StreamingResponse
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(LIVE_ENGAGE_CSV_COLUMNS)
    writer.writerow(["datr=abc;c_user=123;xs=xyz", "user@example.com", "", "", "", "", "", "", ""])
    writer.writerow(["datr=def;c_user=456;xs=uvw", "user2@example.com", "EAABx...", "JBSWY3DP", "proxy.host.com", "8080", "proxyuser", "proxypass", "Mozilla/5.0..."])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=live_engage_accounts_template.csv"},
    )


@router.post("/live-engage/parse-accounts-csv")
async def live_engage_parse_accounts_csv(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Parse uploaded CSV and return validated accounts as JSON (not stored yet).

    Frontend sends these back in the start request as direct_accounts.
    """
    import csv
    import io

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    fields_lower = {f.strip().lower() for f in reader.fieldnames}
    if "cookies" not in fields_lower:
        raise HTTPException(status_code=400, detail="CSV must have a 'cookies' column")
    if "email" not in fields_lower:
        raise HTTPException(status_code=400, detail="CSV must have an 'email' column")

    accounts = []
    errors = []
    for i, raw_row in enumerate(reader, start=2):
        row = {k.strip().lower(): (v or "").strip() for k, v in raw_row.items() if k}
        if not row.get("cookies"):
            errors.append(f"Row {i}: missing cookies")
            continue
        if not row.get("email"):
            errors.append(f"Row {i}: missing email")
            continue
        accounts.append({
            "cookies": row["cookies"],
            "email": row["email"],
            "token": row.get("token") or None,
            "twofa": row.get("twofa") or row.get("2fa") or row.get("2fa_secret") or None,
            "proxy_host": row.get("proxy_host") or None,
            "proxy_port": row.get("proxy_port") or None,
            "proxy_username": row.get("proxy_username") or None,
            "proxy_password": row.get("proxy_password") or None,
            "user_agent": row.get("user_agent") or None,
        })

    if not accounts:
        raise HTTPException(status_code=400, detail=f"No valid accounts found. {'; '.join(errors[:5])}")
    if len(accounts) > 200:
        raise HTTPException(status_code=400, detail=f"Too many accounts ({len(accounts)}). Max 200.")

    # Duplicate detection
    seen_emails: set[str] = set()
    seen_cookies: set[str] = set()
    duplicates: list[str] = []
    unique_accounts: list[dict] = []
    for acct in accounts:
        email_key = acct["email"].lower().strip()
        cookie_key = acct["cookies"][:50]  # first 50 chars as fingerprint
        if email_key in seen_emails:
            duplicates.append(f"Duplicate email: {acct['email']}")
            continue
        if cookie_key in seen_cookies:
            duplicates.append(f"Duplicate cookies: {acct['email']}")
            continue
        seen_emails.add(email_key)
        seen_cookies.add(cookie_key)
        unique_accounts.append(acct)

    return {
        "accounts": unique_accounts,
        "total": len(unique_accounts),
        "duplicates": duplicates[:10],
        "errors": errors[:10],
    }


def _detect_languages_from_comments(comments: list[str]) -> dict[str, int]:
    stats = {"chinese": 0, "english": 0}
    chinese_re = re.compile(r'[\u4e00-\u9fff]')
    # Skip pure numbers, codes, and very short non-text messages
    non_text_re = re.compile(r'^[\s\d+＋.,!?@#$%^&*()_\-=\[\]{}|\\/:;<>~`]+$')
    for msg in comments:
        stripped = msg.strip()
        if not stripped or len(stripped) < 2:
            continue
        # Skip pure numbers/codes/symbols — they're not text
        if non_text_re.match(stripped):
            continue
        if chinese_re.search(stripped):
            stats["chinese"] += 1
        elif re.search(r'[a-zA-Z]{2,}', stripped):
            # Must have at least 2 consecutive letters to count as English
            stats["english"] += 1
        # else: skip (single letter + numbers like "L6", "+1 nak" etc.)
    return {k: v for k, v in stats.items() if v > 0}


def _extract_codes_from_comments(comments: list[str]) -> list[str]:
    code_re = re.compile(r'\b([a-zA-Z]{1,3}\d{1,5})\b')
    number_re = re.compile(r'^\s*(\d{1,5})\s*(?:[+＋]\s*\d{1,3})?\s*$')
    # Currency/price prefixes to exclude
    price_prefixes = {"RM", "USD", "SGD", "IDR", "PHP", "THB", "VND", "MYR", "CNY", "RMB",
                      "HKD", "TWD", "AUD", "EUR", "GBP", "JPY", "KRW", "INR", "BND", "QS"}
    counts: dict[str, int] = {}
    for msg in comments:
        for m in code_re.findall(msg):
            upper = m.upper()
            # Skip price patterns (RM68, USD50, etc.)
            is_price = any(upper.startswith(p) and upper[len(p):].isdigit() for p in price_prefixes)
            if not is_price:
                counts[upper] = counts.get(upper, 0) + 1
        if len(msg.strip()) <= 10:
            nm = number_re.match(msg.strip())
            if nm:
                counts[nm.group(1)] = counts.get(nm.group(1), 0) + 1
    return [c for c, n in sorted(counts.items(), key=lambda x: -x[1]) if n >= 2][:20]


def _parse_json_safe(content: str, fallback=None):
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3]
    try:
        return json.loads(content.strip())
    except (json.JSONDecodeError, ValueError):
        return fallback or {}


@router.post("/live-engage/smart-setup")
async def live_engage_smart_setup(
    req: SmartSetupRequest,
    user: User = Depends(get_current_user),
):
    """Analyze Facebook page + video and auto-generate livestream engagement config."""
    if not req.page_url and not req.video_url:
        raise HTTPException(status_code=400, detail="Provide at least a page URL or video URL")

    from app.scraping.clients.facebook import FacebookGraphClient
    from openai import AsyncOpenAI
    from app.config import get_settings
    import asyncio as aio

    settings = get_settings()
    client = FacebookGraphClient()
    openai_client = AsyncOpenAI(api_key=settings.openai_api_key)

    # ── Stage 1: Fetch page info ──
    page_info = {}
    if req.page_url:
        try:
            parsed = client.parse_page_input(req.page_url)
            pid = parsed.get("page_id")
            if pid:
                raw = await client.get_object_details(
                    pid, fields="name,about,description,category,website,picture.width(200)"
                )
                if isinstance(raw, dict):
                    page_info = raw.get("data", raw) if isinstance(raw.get("data"), dict) else raw
        except Exception as exc:
            logger.warning(f"[SmartSetup] Page fetch failed: {exc}")

    # ── Stage 2: Scrape comments ──
    all_comments: list[str] = []
    comment_authors: list[tuple[str, str]] = []  # (from_id, message) to separate host later
    commenter_counts: dict[str, int] = {}
    detected_host_id = ""
    post_id = None
    url_to_scrape = req.video_url or req.page_url
    if url_to_scrape:
        try:
            parsed = client.parse_post_url(url_to_scrape)
            post_id = parsed.get("post_id")
        except Exception:
            candidate = url_to_scrape.strip().split("/")[-1].split("?")[0]
            if candidate.isdigit():
                post_id = candidate

        if post_id:
            cursor = None
            for _ in range(max(1, req.max_comments // 50)):
                try:
                    resp = await client.get_post_comments(post_id, limit=50, comment_filter="stream", after=cursor)
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
                        msg = c.get("message", "").strip()
                        from_data = c.get("from", {})
                        from_id = from_data.get("id", "")
                        if msg:
                            all_comments.append(msg)
                            comment_authors.append((from_id, msg))
                            if from_id:
                                commenter_counts[from_id] = commenter_counts.get(from_id, 0) + 1
                    if not ncursor or not cdata:
                        break
                    cursor = ncursor
                except Exception as exc:
                    logger.warning(f"[SmartSetup] Comment fetch failed: {exc}")
                    break

            # Detect host: most frequent commenter (hosts comment a LOT in their own stream)
            if commenter_counts:
                top_commenter = max(commenter_counts, key=commenter_counts.get)
                top_count = commenter_counts[top_commenter]
                # Host typically has 10%+ of all comments
                if top_count >= max(5, len(all_comments) * 0.08):
                    detected_host_id = top_commenter

    if not page_info and not all_comments:
        raise HTTPException(status_code=400, detail="Could not fetch data. Check URLs are valid and public.")

    # ── Stage 3: AI Analysis ──
    lang_stats = _detect_languages_from_comments(all_comments) if all_comments else {"english": 1}
    detected_codes = _extract_codes_from_comments(all_comments) if all_comments else []
    avg_len = round(sum(len(c) for c in all_comments) / max(len(all_comments), 1)) if all_comments else 0
    unique = list(dict.fromkeys(all_comments))[:100]

    # Separate host comments (product info, prices, instructions)
    host_messages: list[str] = []
    viewer_messages: list[str] = []
    if detected_host_id:
        for fid, msg in comment_authors:
            if fid == detected_host_id:
                host_messages.append(msg)
            else:
                viewer_messages.append(msg)
    else:
        viewer_messages = list(all_comments)

    host_sample = "\n".join(f"- {m}" for m in dict.fromkeys(host_messages).keys())[:2000] if host_messages else ""

    page_sum = ""
    if page_info:
        page_sum = f"Name: {page_info.get('name', '?')}\nCategory: {page_info.get('category', '?')}\nAbout: {page_info.get('about', '')}\nDescription: {page_info.get('description', '')}"

    dominant = max(lang_stats, key=lang_stats.get) if lang_stats else "english"
    lang_list = [k for k, v in sorted(lang_stats.items(), key=lambda x: -x[1]) if v > 0]
    comments_sample = "\n".join(f"- {c}" for c in unique)

    prompt = f"""You are a Facebook Livestream engagement expert. Analyze this data and generate optimal config.

=== PAGE ===
{page_sum or "N/A"}

=== HOST/LIVESTREAMER COMMENTS ({len(host_messages)} messages) ===
{host_sample or "No host comments detected — use viewer comments to infer products"}

{f"The host comments above MAY contain product codes, prices, and ordering instructions. Use them to enrich business_context and detect product codes. However, host comments vary — some hosts post detailed product info, others barely comment. Do NOT assume all info is in host comments — also analyze viewer comments for clues about products and codes." if host_messages else "No host detected. Analyze viewer comments to understand what products are being sold."}

=== COMMENTS ({len(all_comments)} total, {len(unique)} unique) ===
{comments_sample or "N/A"}

=== DETECTED ===
Languages: {json.dumps(lang_stats)}
Codes (2+ occurrences): {', '.join(detected_codes) or 'None'}
Avg comment length: {avg_len} chars

Generate JSON:
{{"business_context":"2-4 sentences specific to THIS business, written in {dominant}","ai_instructions":"1-2 sentence rules written in {dominant} for AI tone/language/style. Example: 用华语，简短自然，参考产品编号","training_comments":"50-80 REAL comments from above (one per line, do NOT invent)","languages":{json.dumps(lang_list)},"product_codes":"{', '.join(detected_codes[:15])}","code_pattern":"3-5 example codes from the comments above that show what codes look like (e.g. 520, 66, 1, 88 or L6, E204, m3). Use REAL codes from the data, NOT words like numeric","role_distribution":{{"ask_question":N,"place_order":N,"repeat_question":N,"good_vibe":N,"react_comment":N,"share_experience":N}},"aggressive_level":"low/medium/high","quantity_variation":true,"auto_order_trending":{str(bool(detected_codes)).lower()},"auto_order_trending_threshold":3,"suggested_title":"short name in {dominant}"}}

Rules: role_distribution sums to 100. If heavy ordering→place_order 50-60%. training_comments MUST be real from sample."""

    try:
        ai_resp = await aio.wait_for(
            openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "Generate the config."},
                ],
                temperature=0.3, max_tokens=4000,
                response_format={"type": "json_object"},
            ),
            timeout=60,
        )
        config = _parse_json_safe(ai_resp.choices[0].message.content or "{}")
    except aio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI analysis timed out (60s). Try again with fewer comments.")
    except Exception as exc:
        logger.warning(f"[SmartSetup] AI analysis failed: {exc}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(exc)[:200]}")

    # Normalize role distribution to 100
    roles = config.get("role_distribution", {})
    total = sum(roles.values())
    if total > 0 and total != 100:
        factor = 100 / total
        config["role_distribution"] = {k: max(1, round(v * factor)) for k, v in roles.items()}
        diff = 100 - sum(config["role_distribution"].values())
        if diff:
            top = max(config["role_distribution"], key=config["role_distribution"].get)
            config["role_distribution"][top] += diff

    return {
        "config": config,
        "page_info": {
            "name": page_info.get("name", ""),
            "category": page_info.get("category", ""),
            "about": page_info.get("about", ""),
            "picture": (page_info.get("picture") or {}).get("data", {}).get("url", ""),
        } if page_info else None,
        "stats": {
            "comments_analyzed": len(all_comments),
            "unique_comments": len(unique),
            "codes_detected": detected_codes,
            "languages": lang_stats,
            "avg_comment_length": avg_len,
        },
        "post_id": post_id,
        "page_owner_id": detected_host_id,
    }
    # Clean up HTTP client
    try:
        await client.close()
    except Exception:
        pass


@router.get("/live-engage/recent-accounts")
async def live_engage_recent_accounts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return recent sessions that used direct CSV accounts for reuse."""
    result = await db.execute(
        select(FBLiveEngageSession)
        .where(
            FBLiveEngageSession.tenant_id == user.tenant_id,
            FBLiveEngageSession.direct_accounts_encrypted.isnot(None),
        )
        .order_by(FBLiveEngageSession.created_at.desc())
        .limit(5)
    )
    sessions = result.scalars().all()

    from app.services.meta_api import MetaAPIService
    meta = MetaAPIService()

    items = []
    for s in sessions:
        try:
            decrypted = meta.decrypt_token(s.direct_accounts_encrypted)
            accounts = json.loads(decrypted)
            items.append({
                "session_id": str(s.id),
                "title": s.title or s.post_id,
                "account_count": len(accounts),
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "accounts": accounts,
            })
        except Exception:
            continue

    return {"recent": items}


@router.get("/live-engage/import-comments/{job_id}")
async def live_engage_import_comments(
    job_id: str,
    limit: int = Query(500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch comment messages from a scrape job for importing into Style Guide."""
    from app.models.job import ScrapingJob, ExtractedComment

    # Verify job ownership
    job_result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Fetch comments
    result = await db.execute(
        select(ExtractedComment.comment_text, ExtractedComment.commenter_name)
        .where(
            ExtractedComment.job_id == job_id,
            ExtractedComment.comment_text.isnot(None),
            ExtractedComment.comment_text != "",
        )
        .order_by(ExtractedComment.comment_time.desc().nulls_last())
        .limit(limit)
    )
    comments = result.all()

    return {
        "job_id": str(job.id),
        "job_input": job.input_value,
        "total": len(comments),
        "comments": [
            {"name": c[1] or "", "message": c[0]}
            for c in comments
        ],
    }


@router.get("/live-engage/history")
async def live_engage_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    search: str | None = Query(None),
):
    """List livestream engagement sessions with optional filters."""
    offset = (page - 1) * page_size

    filters = [FBLiveEngageSession.tenant_id == user.tenant_id]
    if status:
        filters.append(FBLiveEngageSession.status == status)
    if search:
        filters.append(
            (FBLiveEngageSession.title.ilike(f"%{search}%")) |
            (FBLiveEngageSession.post_id.ilike(f"%{search}%"))
        )

    count_result = await db.execute(
        select(func.count(FBLiveEngageSession.id)).where(*filters)
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(FBLiveEngageSession)
        .where(*filters)
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


@router.post("/live-engage/preview-comments")
async def live_engage_preview_comments(
    req: LiveEngageStartRequest,
    user: User = Depends(get_current_user),
):
    """Generate 5 sample comments for preview — no session created, no posting."""
    from app.services.ai_live_engage import AILiveEngageService

    ai_service = AILiveEngageService()
    role_dist = req.role_distribution or DEFAULT_ROLE_DISTRIBUTION
    roles = list(role_dist.keys())
    weights = [role_dist[r] for r in roles]

    mock_comments = [
        {"from_name": "Viewer", "message": "How much?", "from_id": "1"},
        {"from_name": "Buyer", "message": "+1 nak", "from_id": "2"},
        {"from_name": "Fan", "message": "Cantik!", "from_id": "3"},
    ]

    seed_codes = [c.strip() for c in (req.product_codes or "").split(",") if c.strip()]
    languages_str = ",".join(req.languages) if req.languages else ""
    samples = []
    for _ in range(5):
        role = random.choices(roles, weights=weights, k=1)[0]
        try:
            content = await ai_service.generate_comment(
                role=role,
                recent_comments=mock_comments,
                business_context=req.business_context or "",
                training_comments=req.training_comments,
                ai_instructions=req.ai_instructions or "",
                detected_codes=seed_codes or None,
                quantity_variation=req.quantity_variation,
                languages=languages_str,
            )
            samples.append({"role": role, "content": content})
        except Exception as exc:
            samples.append({"role": role, "content": f"(error: {exc})"})

    return {"samples": samples}


# ── Presets CRUD ──────────────────────────────────────────────

@router.get("/live-engage/presets")
async def live_engage_list_presets(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all saved presets for this tenant."""
    from app.models.fb_live_engage import FBLiveEngagePreset

    result = await db.execute(
        select(FBLiveEngagePreset).where(
            FBLiveEngagePreset.tenant_id == user.tenant_id,
        ).order_by(FBLiveEngagePreset.updated_at.desc())
    )
    presets = result.scalars().all()
    return {
        "presets": [
            {
                "id": str(p.id),
                "name": p.name,
                "role_distribution": p.role_distribution,
                "business_context": p.business_context,
                "training_comments": p.training_comments,
                "ai_instructions": p.ai_instructions,
                "product_codes": p.product_codes,
                "code_pattern": p.code_pattern,
                "quantity_variation": p.quantity_variation,
                "aggressive_level": p.aggressive_level,
                "scrape_interval_seconds": p.scrape_interval_seconds,
                "context_window": getattr(p, "context_window", 50),
                "ai_context_count": getattr(p, "ai_context_count", 15),
                "min_delay_seconds": p.min_delay_seconds,
                "max_delay_seconds": p.max_delay_seconds,
                "max_duration_minutes": p.max_duration_minutes,
                "target_comments_enabled": p.target_comments_enabled,
                "target_comments_count": p.target_comments_count,
                "target_comments_period_minutes": p.target_comments_period_minutes,
                "blacklist_words": p.blacklist_words,
                "stream_end_threshold": p.stream_end_threshold,
                "languages": p.languages.split(",") if p.languages else [],
                "comment_without_new": p.comment_without_new,
                "comment_without_new_max": p.comment_without_new_max,
                "auto_order_trending": p.auto_order_trending,
                "auto_order_trending_threshold": p.auto_order_trending_threshold,
                "auto_order_trending_cooldown": p.auto_order_trending_cooldown,
                "track_host_product": getattr(p, "track_host_product", True),
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in presets
        ]
    }


@router.post("/live-engage/presets")
async def live_engage_save_preset(
    data: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save current config as a reusable preset."""
    from app.models.fb_live_engage import FBLiveEngagePreset

    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Preset name is required")

    preset = FBLiveEngagePreset(
        tenant_id=user.tenant_id,
        user_id=user.id,
        name=name,
        role_distribution=data.get("role_distribution"),
        business_context=data.get("business_context", ""),
        training_comments=data.get("training_comments"),
        ai_instructions=data.get("ai_instructions", ""),
        product_codes=data.get("product_codes"),
        code_pattern=data.get("code_pattern"),
        quantity_variation=data.get("quantity_variation", True),
        aggressive_level=data.get("aggressive_level", "medium"),
        scrape_interval_seconds=data.get("scrape_interval_seconds", 8),
        context_window=data.get("context_window", 50),
        ai_context_count=data.get("ai_context_count", 15),
        min_delay_seconds=data.get("min_delay_seconds", 15),
        max_delay_seconds=data.get("max_delay_seconds", 60),
        max_duration_minutes=data.get("max_duration_minutes", 180),
        target_comments_enabled=data.get("target_comments_enabled", False),
        target_comments_count=data.get("target_comments_count"),
        target_comments_period_minutes=data.get("target_comments_period_minutes"),
        blacklist_words=data.get("blacklist_words"),
        stream_end_threshold=data.get("stream_end_threshold", 10),
        languages=",".join(data.get("languages", [])) if data.get("languages") else None,
        comment_without_new=data.get("comment_without_new", False),
        comment_without_new_max=data.get("comment_without_new_max", 3),
        auto_order_trending=data.get("auto_order_trending", False),
        auto_order_trending_threshold=data.get("auto_order_trending_threshold", 3),
        auto_order_trending_cooldown=data.get("auto_order_trending_cooldown", 60),
        track_host_product=data.get("track_host_product", True),
    )
    db.add(preset)
    await db.commit()
    return {"id": str(preset.id), "name": preset.name}


@router.delete("/live-engage/presets/{preset_id}")
async def live_engage_delete_preset(
    preset_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a preset."""
    from app.models.fb_live_engage import FBLiveEngagePreset

    result = await db.execute(
        select(FBLiveEngagePreset).where(
            FBLiveEngagePreset.id == preset_id,
            FBLiveEngagePreset.tenant_id == user.tenant_id,
        )
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    await db.delete(preset)
    await db.commit()
    return {"deleted": True}


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
        .limit(100)
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
        "aggressive_level": session.aggressive_level,
        "scrape_interval_seconds": session.scrape_interval_seconds,
        "context_window": session.context_window,
        "ai_context_count": session.ai_context_count,
        "min_delay_seconds": session.min_delay_seconds,
        "max_delay_seconds": session.max_delay_seconds,
        "max_duration_minutes": session.max_duration_minutes,
        "blacklist_words": session.blacklist_words,
        "ai_instructions": session.ai_instructions,
        "quantity_variation": session.quantity_variation,
        "languages": session.languages.split(",") if session.languages else [],
        "stream_end_threshold": session.stream_end_threshold,
        "comment_without_new": session.comment_without_new,
        "comment_without_new_max": session.comment_without_new_max,
        "auto_order_trending": session.auto_order_trending,
        "auto_order_trending_threshold": session.auto_order_trending_threshold,
        "auto_order_trending_cooldown": session.auto_order_trending_cooldown,
        "track_host_product": session.track_host_product,
        "product_codes": session.product_codes,
        "code_pattern": session.code_pattern,
        "business_context": session.business_context,
        "training_comments": session.training_comments,
        "target_comments_enabled": session.target_comments_enabled,
        "target_comments_count": session.target_comments_count,
        "target_comments_period_minutes": session.target_comments_period_minutes,
        "error_message": session.error_message,
        "live_metrics": session.live_metrics,
        "pending_actions": session.pending_actions,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
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
    if session.status in ("stopped", "completed", "failed"):
        raise HTTPException(status_code=400, detail=f"Session already ended (status: {session.status})")

    session.status = "stopped"
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()

    return {"id": str(session.id), "status": "stopped"}


@router.post("/live-engage/{session_id}/pause")
async def live_engage_pause(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pause a running livestream engagement session (monitor continues, posting paused)."""
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

    session.status = "paused"
    await db.commit()
    return {"id": str(session.id), "status": "paused"}


@router.post("/live-engage/{session_id}/resume")
async def live_engage_resume(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resume a paused livestream engagement session."""
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == session_id,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "paused":
        raise HTTPException(status_code=400, detail=f"Session is not paused (status: {session.status})")

    session.status = "running"
    await db.commit()
    return {"id": str(session.id), "status": "running"}


@router.post("/live-engage/{session_id}/trigger-code")
async def live_engage_trigger_code(
    session_id: str,
    data: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a code to the trigger queue. Supports multiple codes."""
    try:
        sid = uuid.UUID(session_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid session ID")
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == sid,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status not in ("running", "paused"):
        raise HTTPException(status_code=400, detail="Session is not active")

    code = data.get("code", "").strip()
    try:
        count = min(max(int(data.get("count") or 5), 1), 50)
        duration_minutes = min(max(int(data.get("duration_minutes") or 2), 1), 10)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="count and duration_minutes must be numbers")

    if not code:
        raise HTTPException(status_code=400, detail="Code is required")

    trigger_id = str(uuid.uuid4())[:8]
    pending = dict(session.pending_actions or {})
    queue = list(pending.get("trigger_queue", []))
    qty_variation = bool(data.get("quantity_variation", True))
    queue.append({
        "id": trigger_id,
        "code": code,
        "count": count,
        "duration_minutes": duration_minutes,
        "quantity_variation": qty_variation,
        "status": "pending",
        "added_at": datetime.now(timezone.utc).isoformat(),
    })
    pending["trigger_queue"] = queue
    session.pending_actions = pending
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(session, "pending_actions")
    await db.commit()

    return {"ok": True, "id": trigger_id, "code": code, "count": count, "queue_size": len(queue)}


@router.patch("/live-engage/{session_id}/trigger-code/{trigger_id}")
async def live_engage_update_trigger(
    session_id: str,
    trigger_id: str,
    data: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a trigger in the queue (pause, resume, delete, reorder)."""
    try:
        sid = uuid.UUID(session_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid session ID")
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == sid,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    pending = dict(session.pending_actions or {})
    queue = list(pending.get("trigger_queue", []))

    action = data.get("action", "")  # pause, resume, delete, move_up, move_down

    if action == "delete":
        queue = [t for t in queue if t["id"] != trigger_id]
    elif action in ("pause", "resume"):
        for t in queue:
            if t["id"] == trigger_id:
                t["status"] = "paused" if action == "pause" else "pending"
    elif action == "move_up":
        for i, t in enumerate(queue):
            if t["id"] == trigger_id and i > 0:
                queue[i], queue[i - 1] = queue[i - 1], queue[i]
                break
    elif action == "move_down":
        for i, t in enumerate(queue):
            if t["id"] == trigger_id and i < len(queue) - 1:
                queue[i], queue[i + 1] = queue[i + 1], queue[i]
                break

    pending["trigger_queue"] = queue
    session.pending_actions = pending
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(session, "pending_actions")
    await db.commit()

    return {"ok": True, "queue": queue}


@router.patch("/live-engage/{session_id}/settings")
async def live_engage_update_settings(
    session_id: str,
    data: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update session settings in real-time while running."""
    try:
        sid = uuid.UUID(session_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid session ID")
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == sid,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status not in ("running", "paused"):
        raise HTTPException(status_code=400, detail="Session is not active")

    # Allowed fields to update live
    updatable = {
        "role_distribution": dict,
        "aggressive_level": str,
        "min_delay_seconds": int,
        "max_delay_seconds": int,
        "scrape_interval_seconds": int,
        "context_window": int,
        "ai_context_count": int,
        "target_comments_enabled": bool,
        "target_comments_count": int,
        "target_comments_period_minutes": int,
        "comment_without_new": bool,
        "comment_without_new_max": int,
        "blacklist_words": str,
        "stream_end_threshold": int,
        "quantity_variation": bool,
        "languages": str,
        "ai_instructions": str,
        "product_codes": str,
        "code_pattern": str,
        "auto_order_trending": bool,
        "auto_order_trending_threshold": int,
        "auto_order_trending_cooldown": int,
        "track_host_product": bool,
        "business_context": str,
        "training_comments": str,
        "max_duration_minutes": int,
    }

    updated = {}
    for field, expected_type in updatable.items():
        if field in data:
            val = data[field]
            if isinstance(val, expected_type) or val is None:
                setattr(session, field, val)
                updated[field] = val

    # Validate role_distribution sum if updated
    if "role_distribution" in updated:
        total = sum(updated["role_distribution"].values())
        if total != 100:
            raise HTTPException(status_code=400, detail=f"Role percentages must sum to 100, got {total}")

    # Signal the task to reload config
    from sqlalchemy.orm.attributes import flag_modified
    pending = dict(session.pending_actions or {})
    pending["reload_config"] = datetime.now(timezone.utc).isoformat()
    session.pending_actions = pending
    flag_modified(session, "pending_actions")
    await db.commit()

    return {"ok": True, "updated": list(updated.keys())}


@router.get("/live-engage/{session_id}/export")
async def live_engage_export(
    session_id: str,
    format: str = Query("csv", pattern="^(csv|json)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export detailed engagement report with all logs."""
    result = await db.execute(
        select(FBLiveEngageSession).where(
            FBLiveEngageSession.id == session_id,
            FBLiveEngageSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Fetch ALL logs (not just last 30)
    logs_result = await db.execute(
        select(FBLiveEngageLog)
        .where(FBLiveEngageLog.session_id == session.id)
        .order_by(FBLiveEngageLog.created_at.asc())
    )
    logs = logs_result.scalars().all()

    if format == "json":
        report = {
            "session": {
                "id": str(session.id),
                "title": session.title,
                "post_id": session.post_id,
                "post_url": session.post_url,
                "status": session.status,
                "started_at": session.started_at.isoformat() if session.started_at else None,
                "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                "duration_minutes": round(
                    (session.ended_at - session.started_at).total_seconds() / 60, 1
                ) if session.ended_at and session.started_at else None,
                "total_comments_posted": session.total_comments_posted,
                "total_errors": session.total_errors,
                "comments_monitored": session.comments_monitored,
                "active_accounts": session.active_accounts,
                "comments_by_role": session.comments_by_role,
                "role_distribution": session.role_distribution,
                "aggressive_level": session.aggressive_level,
                "live_metrics": session.live_metrics,
                "error_message": session.error_message,
            },
            "logs": [
                {
                    "timestamp": log.created_at.isoformat() if log.created_at else None,
                    "role": log.role,
                    "status": log.status,
                    "account": log.account_email,
                    "content": log.content,
                    "reference_comment": log.reference_comment,
                    "error": log.error_message,
                }
                for log in logs
            ],
            "summary": {
                "total_logs": len(logs),
                "success_count": sum(1 for l in logs if l.status == "success"),
                "error_count": sum(1 for l in logs if l.status != "success"),
                "unique_accounts_used": len({l.account_email for l in logs}),
                "roles_breakdown": {},
            },
        }
        # Build roles breakdown
        for log in logs:
            key = f"{log.role}_{log.status}"
            report["summary"]["roles_breakdown"][key] = report["summary"]["roles_breakdown"].get(key, 0) + 1

        return report

    # CSV export
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Timestamp", "Role", "Status", "Account", "Content",
        "Reference Comment", "Error Message",
    ])
    for log in logs:
        writer.writerow([
            log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
            log.role or "",
            log.status or "",
            log.account_email or "",
            log.content or "",
            log.reference_comment or "",
            log.error_message or "",
        ])

    # Add summary rows at the end
    writer.writerow([])
    writer.writerow(["=== SESSION SUMMARY ==="])
    writer.writerow(["Title", session.title or ""])
    writer.writerow(["Post ID", session.post_id or ""])
    writer.writerow(["Status", session.status or ""])
    writer.writerow(["Started", session.started_at.strftime("%Y-%m-%d %H:%M:%S") if session.started_at else ""])
    writer.writerow(["Ended", session.ended_at.strftime("%Y-%m-%d %H:%M:%S") if session.ended_at else ""])
    if session.ended_at and session.started_at:
        duration = (session.ended_at - session.started_at).total_seconds() / 60
        writer.writerow(["Duration", f"{duration:.1f} minutes"])
    writer.writerow(["Total Posted", session.total_comments_posted or 0])
    writer.writerow(["Total Errors", session.total_errors or 0])
    writer.writerow(["Comments Monitored", session.comments_monitored or 0])
    writer.writerow(["Active Accounts", session.active_accounts or 0])
    if session.comments_by_role and isinstance(session.comments_by_role, dict):
        writer.writerow([])
        writer.writerow(["=== COMMENTS BY ROLE ==="])
        for role, count in session.comments_by_role.items():
            writer.writerow([role.replace("_", " ").title(), count])

    # Encode as UTF-8 bytes with BOM for Excel compatibility
    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    # Sanitize filename
    safe_title = re.sub(r'[^\w\s-]', '', session.title or "session")[:50].strip()
    safe_post = re.sub(r'[^\w-]', '', session.post_id or "")[:30]
    filename = f"live_engage_{safe_title}_{safe_post}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )
