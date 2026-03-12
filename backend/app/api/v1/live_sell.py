"""API endpoints for the Livestream Sell Helper feature."""

import csv
import io
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.fb_ads import FBPage
from app.models.fb_live_sell import LiveComment, LiveSession
from app.models.system import SystemSetting
from app.models.user import User
from app.services.meta_api import MetaAPIService

router = APIRouter()

DEFAULT_SETTINGS = {
    "order_keywords": ["+1", "order", "nak", "beli", "want", "buy", "pm"],
    "auto_reply_enabled": False,
    "auto_reply_mode": "template",
    "auto_reply_template": "Hi {name}, thank you for your order! We'll DM you shortly.",
    "ai_reply_instructions": "",
}


def _settings_key(tenant_id: UUID) -> str:
    return f"live_sell_settings_{tenant_id}"


async def _get_selected_page(db: AsyncSession, tenant_id: UUID) -> FBPage:
    """Get the currently selected FB page for the tenant."""
    result = await db.execute(
        select(FBPage).where(
            FBPage.tenant_id == tenant_id,
            FBPage.is_selected == True,
        )
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=400, detail="No Facebook page selected. Connect a page in FB Ads first.")
    if not page.access_token_encrypted:
        raise HTTPException(status_code=400, detail="No page access token. Please reconnect your Facebook page.")
    return page


# ── Videos ──────────────────────────────────────────────────

@router.get("/videos")
async def list_videos(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List videos from the selected page, including live status."""
    page = await _get_selected_page(db, user.tenant_id)
    meta = MetaAPIService()
    token = meta.decrypt_token(page.access_token_encrypted)
    videos = await meta.list_page_videos(token, page.page_id)
    return {"videos": videos, "page_name": page.name}


# ── Sessions ────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    video_id: str
    title: str | None = None


@router.post("/sessions")
async def start_session(
    data: StartSessionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start monitoring a live video for comments."""
    page = await _get_selected_page(db, user.tenant_id)

    # Check no active session for this tenant
    existing = await db.execute(
        select(LiveSession).where(
            LiveSession.tenant_id == user.tenant_id,
            LiveSession.status == "monitoring",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have an active monitoring session. Stop it first.")

    # Load tenant settings
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == _settings_key(user.tenant_id))
    )
    setting = result.scalar_one_or_none()
    sess_settings = setting.value if setting else DEFAULT_SETTINGS.copy()

    session = LiveSession(
        tenant_id=user.tenant_id,
        user_id=user.id,
        fb_page_id=page.id,
        video_id=data.video_id,
        title=data.title,
        status="monitoring",
        settings=sess_settings,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Launch Celery task
    from app.services.live_sell_tasks import monitor_live_session
    task = monitor_live_session.delay(str(session.id))
    session.celery_task_id = task.id
    await db.commit()

    return {
        "id": str(session.id),
        "video_id": session.video_id,
        "title": session.title,
        "status": session.status,
        "started_at": session.started_at.isoformat(),
    }


@router.get("/sessions")
async def list_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List all monitoring sessions for the tenant."""
    query = (
        select(LiveSession)
        .where(LiveSession.tenant_id == user.tenant_id)
        .order_by(LiveSession.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    sessions = result.scalars().all()

    count_result = await db.execute(
        select(func.count()).select_from(LiveSession).where(
            LiveSession.tenant_id == user.tenant_id
        )
    )
    total = count_result.scalar() or 0

    return {
        "sessions": [
            {
                "id": str(s.id),
                "video_id": s.video_id,
                "title": s.title,
                "status": s.status,
                "total_comments": s.total_comments,
                "total_orders": s.total_orders,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "created_at": s.created_at.isoformat(),
            }
            for s in sessions
        ],
        "total": total,
        "page": page,
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get details of a monitoring session."""
    result = await db.execute(
        select(LiveSession).where(
            LiveSession.id == session_id,
            LiveSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "id": str(session.id),
        "video_id": session.video_id,
        "title": session.title,
        "status": session.status,
        "total_comments": session.total_comments,
        "total_orders": session.total_orders,
        "settings": session.settings,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "created_at": session.created_at.isoformat(),
    }


@router.post("/sessions/{session_id}/stop")
async def stop_session(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stop monitoring a live session."""
    result = await db.execute(
        select(LiveSession).where(
            LiveSession.id == session_id,
            LiveSession.tenant_id == user.tenant_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "monitoring":
        raise HTTPException(status_code=400, detail="Session is not actively monitoring")

    session.status = "stopped"
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()

    return {"status": "stopped", "ended_at": session.ended_at.isoformat()}


# ── Comments ────────────────────────────────────────────────

@router.get("/sessions/{session_id}/comments")
async def list_comments(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    orders_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List comments for a session, optionally filtered to orders only."""
    # Verify session ownership
    sess_result = await db.execute(
        select(LiveSession.id).where(
            LiveSession.id == session_id,
            LiveSession.tenant_id == user.tenant_id,
        )
    )
    if not sess_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    query = select(LiveComment).where(LiveComment.session_id == session_id)
    count_query = select(func.count()).select_from(LiveComment).where(
        LiveComment.session_id == session_id
    )

    if orders_only:
        query = query.where(LiveComment.is_order == True)
        count_query = count_query.where(LiveComment.is_order == True)

    query = (
        query.order_by(LiveComment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    comments = result.scalars().all()
    total = (await db.execute(count_query)).scalar() or 0

    return {
        "comments": [
            {
                "id": str(c.id),
                "fb_comment_id": c.fb_comment_id,
                "commenter_id": c.commenter_id,
                "commenter_name": c.commenter_name,
                "message": c.message,
                "is_order": c.is_order,
                "matched_keywords": c.matched_keywords or [],
                "replied": c.replied,
                "reply_message": c.reply_message,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ],
        "total": total,
        "page": page,
    }


# ── Manual reply ─────────────────────────────────────────────

class ReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.post("/sessions/{session_id}/comments/{comment_id}/reply")
async def reply_to_comment(
    session_id: UUID,
    comment_id: UUID,
    data: ReplyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually reply to a comment."""
    # Verify session ownership
    sess_result = await db.execute(
        select(LiveSession).where(
            LiveSession.id == session_id,
            LiveSession.tenant_id == user.tenant_id,
        )
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get comment
    comment_result = await db.execute(
        select(LiveComment).where(
            LiveComment.id == comment_id,
            LiveComment.session_id == session_id,
        )
    )
    comment = comment_result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Get page token
    page = await _get_selected_page(db, user.tenant_id)
    meta = MetaAPIService()
    token = meta.decrypt_token(page.access_token_encrypted)

    # Reply via Graph API
    try:
        await meta.reply_to_comment(token, comment.fb_comment_id, data.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to reply: {str(e)}")

    comment.replied = True
    comment.reply_message = data.message
    await db.commit()

    return {"success": True, "reply_message": data.message}


# ── Export orders CSV ────────────────────────────────────────

@router.get("/sessions/{session_id}/orders/export")
async def export_orders(
    session_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export detected orders as CSV."""
    # Verify session ownership
    sess_result = await db.execute(
        select(LiveSession).where(
            LiveSession.id == session_id,
            LiveSession.tenant_id == user.tenant_id,
        )
    )
    if not sess_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(LiveComment)
        .where(LiveComment.session_id == session_id, LiveComment.is_order == True)
        .order_by(LiveComment.created_at)
    )
    orders = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Comment", "Keywords", "Time", "Replied", "Reply Message"])
    for o in orders:
        writer.writerow([
            o.commenter_name,
            o.message,
            ", ".join(o.matched_keywords or []),
            o.created_at.isoformat() if o.created_at else "",
            "Yes" if o.replied else "No",
            o.reply_message or "",
        ])

    csv_bytes = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=live_orders_{session_id}.csv"},
    )


# ── Settings ─────────────────────────────────────────────────

@router.get("/settings")
async def get_settings_endpoint(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get live sell settings for the tenant."""
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == _settings_key(user.tenant_id))
    )
    setting = result.scalar_one_or_none()
    data = setting.value if setting else DEFAULT_SETTINGS.copy()
    # Merge with defaults for any missing keys
    for k, v in DEFAULT_SETTINGS.items():
        if k not in data:
            data[k] = v
    return data


class UpdateSettingsRequest(BaseModel):
    order_keywords: list[str] | None = None
    auto_reply_enabled: bool | None = None
    auto_reply_mode: str | None = None
    auto_reply_template: str | None = None
    ai_reply_instructions: str | None = None


@router.put("/settings")
async def update_settings(
    data: UpdateSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update live sell settings for the tenant."""
    key = _settings_key(user.tenant_id)
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()

    current = setting.value if setting else DEFAULT_SETTINGS.copy()

    # Update only provided fields
    update_data = data.model_dump(exclude_none=True)
    current.update(update_data)

    if setting:
        setting.value = current
    else:
        db.add(SystemSetting(key=key, value=current))
    await db.commit()

    return current
