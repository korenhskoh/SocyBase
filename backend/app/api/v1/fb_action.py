"""Facebook Action Bot API — execute FB actions via AKNG fb_action endpoint."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.fb_action_log import FBActionLog
from app.models.fb_cookie_session import FBCookieSession
from app.models.user import User
from app.scraping.clients.facebook import FacebookGraphClient
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
