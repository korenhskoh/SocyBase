"""Fan analysis API — engagement metrics, bot detection, AI comment analysis, export."""

import csv
import io
import os
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.fan_analysis import FanAnalysisCache
from app.models.job import ExtractedComment, ScrapedProfile, ScrapingJob
from app.models.tenant import Tenant
from app.models.user import User
from app.services.bot_detector import BotDetector

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_tenant_job(db: AsyncSession, job_id: UUID, tenant_id: UUID) -> ScrapingJob:
    result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _aggregate_fans(db: AsyncSession, job_id: UUID):
    """Aggregate comment data grouped by commenter_user_id."""
    stmt = (
        select(
            ExtractedComment.commenter_user_id,
            func.max(ExtractedComment.commenter_name).label("commenter_name"),
            func.count().label("total_comments"),
            func.count(func.distinct(ExtractedComment.post_id)).label("unique_posts"),
            func.avg(func.length(ExtractedComment.comment_text)).label("avg_length"),
            func.min(ExtractedComment.comment_time).label("first_seen"),
            func.max(ExtractedComment.comment_time).label("last_seen"),
        )
        .where(
            ExtractedComment.job_id == job_id,
            ExtractedComment.commenter_user_id.is_not(None),
            ExtractedComment.commenter_user_id != "",
        )
        .group_by(ExtractedComment.commenter_user_id)
    )
    result = await db.execute(stmt)
    return result.all()


def _engagement_score(total_comments: int, unique_posts: int, avg_length: float) -> float:
    return round((total_comments * 2) + (unique_posts * 5) + ((avg_length or 0) / 10), 1)


# ---------------------------------------------------------------------------
# GET /fan-analysis/jobs/{job_id}  — Fan engagement metrics
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}")
async def get_fan_analysis(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("engagement_score"),
    show_bots: bool = Query(True),
):
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    # Aggregate fans
    rows = await _aggregate_fans(db, job_id)

    # Fetch all comments for bot detection (grouped by user)
    all_comments_stmt = (
        select(ExtractedComment)
        .where(
            ExtractedComment.job_id == job_id,
            ExtractedComment.commenter_user_id.is_not(None),
        )
        .order_by(ExtractedComment.comment_time)
    )
    all_comments_result = await db.execute(all_comments_stmt)
    all_comments = all_comments_result.scalars().all()

    # Group comments by user for bot detection
    comments_by_user: dict[str, list] = {}
    for c in all_comments:
        uid = c.commenter_user_id
        if uid:
            comments_by_user.setdefault(uid, []).append({
                "post_id": c.post_id,
                "comment_text": c.comment_text or "",
                "comment_time": c.comment_time,
            })

    # Fetch cached AI analyses
    cache_stmt = select(FanAnalysisCache).where(FanAnalysisCache.job_id == job_id)
    cache_result = await db.execute(cache_stmt)
    ai_cache = {c.commenter_user_id: c for c in cache_result.scalars().all()}

    # Fetch linked profiles
    profile_stmt = select(ScrapedProfile).where(
        ScrapedProfile.job_id == job_id,
        ScrapedProfile.scrape_status == "success",
    )
    profile_result = await db.execute(profile_stmt)
    profiles_by_uid = {p.platform_user_id: p for p in profile_result.scalars().all()}

    # Build fan list
    detector = BotDetector()
    fans = []
    bot_count = 0
    high_intent_count = 0

    for row in rows:
        uid = row.commenter_user_id
        avg_len = float(row.avg_length or 0)
        score = _engagement_score(row.total_comments, row.unique_posts, avg_len)

        # Bot detection
        user_comments = comments_by_user.get(uid, [])
        bot_result = detector.analyze_fan(user_comments)

        if bot_result["is_bot"]:
            bot_count += 1
            if not show_bots:
                continue

        # AI cache
        cached = ai_cache.get(uid)
        ai_analysis = None
        if cached and cached.buying_intent_score is not None:
            ai_analysis = {
                "buying_intent_score": cached.buying_intent_score,
                "interests": cached.interests or [],
                "sentiment": cached.sentiment,
                "persona_type": cached.persona_type,
                "summary": cached.ai_summary,
                "key_phrases": cached.key_phrases or [],
            }
            if (cached.buying_intent_score or 0) >= 0.6:
                high_intent_count += 1

        # Profile link
        profile = profiles_by_uid.get(uid)
        profile_data = None
        if profile:
            profile_data = {
                "name": profile.name,
                "phone": profile.phone,
                "location": profile.location,
                "picture_url": profile.picture_url,
                "gender": profile.gender,
            }

        fans.append({
            "commenter_user_id": uid,
            "commenter_name": row.commenter_name,
            "total_comments": row.total_comments,
            "unique_posts_commented": row.unique_posts,
            "avg_comment_length": round(avg_len, 1),
            "first_seen": row.first_seen.isoformat() if row.first_seen else None,
            "last_seen": row.last_seen.isoformat() if row.last_seen else None,
            "engagement_score": score,
            "profile": profile_data,
            "ai_analysis": ai_analysis,
            "bot_score": bot_result["bot_score"],
            "is_bot": bot_result["is_bot"],
            "bot_indicators": bot_result["indicators"],
            "bot_details": bot_result["details"],
        })

    # Sort
    sort_key_map = {
        "total_comments": lambda f: f["total_comments"],
        "engagement_score": lambda f: f["engagement_score"],
        "buying_intent": lambda f: (f.get("ai_analysis") or {}).get("buying_intent_score", 0),
    }
    sort_fn = sort_key_map.get(sort_by, sort_key_map["engagement_score"])
    fans.sort(key=sort_fn, reverse=True)

    total = len(fans)
    start = (page - 1) * page_size
    paginated = fans[start : start + page_size]

    return {
        "items": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
        "bot_count": bot_count,
        "high_intent_count": high_intent_count,
    }


# ---------------------------------------------------------------------------
# POST /fan-analysis/ai-analyze  — AI-analyze specific fans
# ---------------------------------------------------------------------------

class AnalyzeFanRequest(BaseModel):
    job_id: str
    commenter_user_ids: list[str] = Field(..., max_length=10)


@router.post("/ai-analyze")
async def analyze_fan_comments(
    data: AnalyzeFanRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    api_key = settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured. Set OPENAI_API_KEY.")

    job = await _get_tenant_job(db, UUID(data.job_id), user.tenant_id)

    # Get business context
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    biz = (tenant.settings or {}).get("business", {}) if tenant else {}
    business_ctx = biz.get("business_name", "") or ""

    from app.services.openai_service import OpenAIService
    openai_svc = OpenAIService(api_key=api_key)

    results = []
    for uid in data.commenter_user_ids[:10]:
        # Fetch comments
        stmt = (
            select(ExtractedComment)
            .where(
                ExtractedComment.job_id == job.id,
                ExtractedComment.commenter_user_id == uid,
            )
            .order_by(ExtractedComment.comment_time.desc())
        )
        res = await db.execute(stmt)
        comments = res.scalars().all()
        if not comments:
            continue

        texts = [c.comment_text for c in comments if c.comment_text]
        fan_name = comments[0].commenter_name or "Unknown"

        analysis = await openai_svc.analyze_fan_comments(
            comments=texts,
            fan_name=fan_name,
            business_context=business_ctx,
        )

        # Upsert cache
        existing_stmt = select(FanAnalysisCache).where(
            FanAnalysisCache.job_id == job.id,
            FanAnalysisCache.commenter_user_id == uid,
        )
        existing_res = await db.execute(existing_stmt)
        cached = existing_res.scalar_one_or_none()

        if cached:
            cached.buying_intent_score = analysis.get("buying_intent_score", 0)
            cached.interests = analysis.get("interests", [])
            cached.sentiment = analysis.get("sentiment", "neutral")
            cached.persona_type = analysis.get("persona_type", "casual")
            cached.ai_summary = analysis.get("summary", "")
            cached.key_phrases = analysis.get("key_phrases", [])
            cached.analyzed_at = datetime.now(timezone.utc)
            cached.token_cost = analysis.get("token_cost", 0)
        else:
            cached = FanAnalysisCache(
                tenant_id=user.tenant_id,
                job_id=job.id,
                commenter_user_id=uid,
                buying_intent_score=analysis.get("buying_intent_score", 0),
                interests=analysis.get("interests", []),
                sentiment=analysis.get("sentiment", "neutral"),
                persona_type=analysis.get("persona_type", "casual"),
                ai_summary=analysis.get("summary", ""),
                key_phrases=analysis.get("key_phrases", []),
                analyzed_at=datetime.now(timezone.utc),
                token_cost=analysis.get("token_cost", 0),
            )
            db.add(cached)

        results.append({"commenter_user_id": uid, "fan_name": fan_name, **analysis})

    await db.flush()
    return {"analyzed_count": len(results), "results": results}


# ---------------------------------------------------------------------------
# POST /fan-analysis/ai-batch/{job_id}  — Batch AI analysis (Celery)
# ---------------------------------------------------------------------------

@router.post("/ai-batch/{job_id}")
async def batch_analyze_fans(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    min_comments: int = Query(3, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured.")

    job = await _get_tenant_job(db, job_id, user.tenant_id)

    from app.scraping.fan_analysis_task import run_fan_analysis_batch
    task = run_fan_analysis_batch.apply_async(
        args=[str(job_id), str(user.tenant_id), min_comments, limit]
    )

    return {
        "task_id": task.id,
        "status": "queued",
        "message": f"Analyzing top {limit} fans with at least {min_comments} comments",
    }


# ---------------------------------------------------------------------------
# GET /fan-analysis/export/{job_id}  — Export fan list
# ---------------------------------------------------------------------------

@router.get("/export/{job_id}")
async def export_fan_analysis(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    format: str = Query("csv"),
    include_bots: bool = Query(True),
):
    job = await _get_tenant_job(db, job_id, user.tenant_id)

    rows = await _aggregate_fans(db, job_id)

    # Fetch bot & AI data
    all_comments_stmt = (
        select(ExtractedComment)
        .where(
            ExtractedComment.job_id == job_id,
            ExtractedComment.commenter_user_id.is_not(None),
        )
    )
    all_comments_result = await db.execute(all_comments_stmt)
    comments_by_user: dict[str, list] = {}
    for c in all_comments_result.scalars().all():
        uid = c.commenter_user_id
        if uid:
            comments_by_user.setdefault(uid, []).append({
                "post_id": c.post_id,
                "comment_text": c.comment_text or "",
                "comment_time": c.comment_time,
            })

    cache_stmt = select(FanAnalysisCache).where(FanAnalysisCache.job_id == job_id)
    cache_result = await db.execute(cache_stmt)
    ai_cache = {c.commenter_user_id: c for c in cache_result.scalars().all()}

    profile_stmt = select(ScrapedProfile).where(
        ScrapedProfile.job_id == job_id,
        ScrapedProfile.scrape_status == "success",
    )
    profile_result = await db.execute(profile_stmt)
    profiles_by_uid = {p.platform_user_id: p for p in profile_result.scalars().all()}

    detector = BotDetector()

    # Build CSV
    output = io.StringIO()
    fieldnames = [
        "User ID", "Name", "Comments", "Unique Posts", "Avg Length",
        "Engagement Score", "First Seen", "Last Seen",
        "Bot Score", "Is Bot", "Buying Intent", "Sentiment",
        "Interests", "Persona", "Phone", "Location",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for row in rows:
        uid = row.commenter_user_id
        avg_len = float(row.avg_length or 0)
        score = _engagement_score(row.total_comments, row.unique_posts, avg_len)
        bot = detector.analyze_fan(comments_by_user.get(uid, []))

        if not include_bots and bot["is_bot"]:
            continue

        cached = ai_cache.get(uid)
        profile = profiles_by_uid.get(uid)

        writer.writerow({
            "User ID": uid,
            "Name": row.commenter_name or "",
            "Comments": row.total_comments,
            "Unique Posts": row.unique_posts,
            "Avg Length": round(avg_len, 1),
            "Engagement Score": score,
            "First Seen": row.first_seen.isoformat() if row.first_seen else "",
            "Last Seen": row.last_seen.isoformat() if row.last_seen else "",
            "Bot Score": bot["bot_score"],
            "Is Bot": "Yes" if bot["is_bot"] else "No",
            "Buying Intent": round(cached.buying_intent_score or 0, 2) if cached else "",
            "Sentiment": cached.sentiment if cached else "",
            "Interests": ", ".join(cached.interests or []) if cached else "",
            "Persona": cached.persona_type if cached else "",
            "Phone": profile.phone if profile else "",
            "Location": profile.location if profile else "",
        })

    content = output.getvalue()
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=fan_analysis_{job_id}.csv"},
    )
