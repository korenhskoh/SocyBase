"""Trends API — viral post detection, content insights, Google Trends."""

import logging
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, distinct, case, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.job import ScrapedPost, ScrapingJob
from app.models.tenant import Tenant
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter()

# Common English stopwords to filter from keyword extraction
_STOPWORDS = frozenset(
    "the a an is are was were be been being have has had do does did will would "
    "shall should may might can could and but or nor for yet so at by from in into "
    "of on to with as it its this that these those he she they we you i my your his "
    "her our their what which who whom how when where why all each every both few "
    "more most other some such no not only same than too very just about above after "
    "again also any before below between down during further here if off once out over "
    "own re still then there through under until up http https www com facebook".split()
)


def _virality_score(
    reactions: int, comments: int, shares: int, created_time: datetime | None,
) -> float:
    """Compute virality score with time decay."""
    engagement = (shares * 10) + (reactions * 2) + (comments * 3)
    if created_time:
        age_hours = max(
            (datetime.now(timezone.utc) - created_time).total_seconds() / 3600, 1,
        )
    else:
        age_hours = 24 * 30  # assume 30 days old if unknown
    return round(engagement / (age_hours ** 0.3), 1)


def _extract_keywords(messages: list[str], top_n: int = 20) -> list[str]:
    """Extract top keywords from post messages using simple word frequency."""
    counter: Counter = Counter()
    for msg in messages:
        if not msg:
            continue
        words = re.findall(r"[a-zA-Z\u0E00-\u0E7F\u4e00-\u9fff]{3,}", msg.lower())
        for w in words:
            if w not in _STOPWORDS and len(w) <= 30:
                counter[w] += 1
    return [word for word, _ in counter.most_common(top_n)]


# ---------------------------------------------------------------------------
# GET /trends/viral-posts
# ---------------------------------------------------------------------------

@router.get("/viral-posts")
async def get_viral_posts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page_id: str | None = Query(None, description="Filter by source page input_value"),
    min_score: float = Query(0, ge=0),
    content_type: str | None = Query(None, description="photo, video, link, etc."),
    days: int = Query(90, ge=7, le=365),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    sort_by: str = Query("virality_score"),
):
    """Analyze scraped posts and return them ranked by virality score."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Find all post_discovery jobs for this tenant
    job_filter = [
        ScrapingJob.tenant_id == user.tenant_id,
        ScrapingJob.job_type == "post_discovery",
        ScrapingJob.status.in_(["completed", "running"]),
    ]
    if page_id:
        job_filter.append(ScrapingJob.input_value == page_id)

    job_result = await db.execute(
        select(ScrapingJob.id, ScrapingJob.input_value).where(*job_filter)
    )
    jobs = job_result.all()
    if not jobs:
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "page_averages": {}}

    job_ids = [j[0] for j in jobs]
    job_input_map = {j[0]: j[1] for j in jobs}

    # Build base query
    post_filter = [
        ScrapedPost.job_id.in_(job_ids),
    ]
    if cutoff:
        post_filter.append(
            (ScrapedPost.created_time >= cutoff) | (ScrapedPost.created_time.is_(None))
        )
    if content_type:
        post_filter.append(ScrapedPost.attachment_type == content_type)

    # Deduplicate by post_id (keep first occurrence)
    dedup_subq = (
        select(
            ScrapedPost.id,
            ScrapedPost.job_id,
            func.row_number().over(
                partition_by=ScrapedPost.post_id,
                order_by=ScrapedPost.created_time.desc().nulls_last(),
            ).label("rn"),
        )
        .where(*post_filter)
        .subquery()
    )

    result = await db.execute(
        select(ScrapedPost)
        .join(dedup_subq, ScrapedPost.id == dedup_subq.c.id)
        .where(dedup_subq.c.rn == 1)
    )
    all_posts = result.scalars().all()

    # Compute per-page average engagement
    page_engagement: dict[str, list[int]] = {}
    for p in all_posts:
        src = job_input_map.get(p.job_id, "unknown")
        eng = (p.reaction_count or 0) + (p.comment_count or 0) + (p.share_count or 0)
        page_engagement.setdefault(src, []).append(eng)

    page_averages = {
        src: round(sum(vals) / len(vals), 1) if vals else 0
        for src, vals in page_engagement.items()
    }

    # Build scored items
    items = []
    for p in all_posts:
        src = job_input_map.get(p.job_id, "unknown")
        score = _virality_score(
            p.reaction_count or 0, p.comment_count or 0,
            p.share_count or 0, p.created_time,
        )
        if score < min_score:
            continue

        eng_total = (p.reaction_count or 0) + (p.comment_count or 0) + (p.share_count or 0)
        avg = page_averages.get(src, 0)
        above_avg = round(eng_total / avg, 1) if avg > 0 else 0

        items.append({
            "id": str(p.id),
            "post_id": p.post_id,
            "message": p.message,
            "created_time": p.created_time.isoformat() if p.created_time else None,
            "from_name": p.from_name,
            "comment_count": p.comment_count or 0,
            "reaction_count": p.reaction_count or 0,
            "share_count": p.share_count or 0,
            "attachment_type": p.attachment_type,
            "attachment_url": p.attachment_url,
            "post_url": p.post_url,
            "virality_score": score,
            "engagement_total": eng_total,
            "source_page": src,
            "above_average": above_avg,
        })

    # Sort
    sort_map = {
        "virality_score": lambda x: x["virality_score"],
        "reactions": lambda x: x["reaction_count"],
        "comments": lambda x: x["comment_count"],
        "shares": lambda x: x["share_count"],
        "recency": lambda x: x["created_time"] or "",
        "engagement": lambda x: x["engagement_total"],
    }
    sort_fn = sort_map.get(sort_by, sort_map["virality_score"])
    items.sort(key=sort_fn, reverse=True)

    total = len(items)
    start = (page - 1) * page_size
    paginated = items[start : start + page_size]

    return {
        "items": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
        "page_averages": page_averages,
    }


# ---------------------------------------------------------------------------
# GET /trends/content-insights
# ---------------------------------------------------------------------------

@router.get("/content-insights")
async def get_content_insights(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page_id: str | None = Query(None),
    days: int = Query(90, ge=7, le=365),
):
    """Aggregate post data into content strategy insights."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Find relevant jobs
    job_filter = [
        ScrapingJob.tenant_id == user.tenant_id,
        ScrapingJob.job_type == "post_discovery",
        ScrapingJob.status.in_(["completed", "running"]),
    ]
    if page_id:
        job_filter.append(ScrapingJob.input_value == page_id)

    job_result = await db.execute(select(ScrapingJob.id).where(*job_filter))
    job_ids = [r[0] for r in job_result.all()]
    if not job_ids:
        return {
            "total_posts": 0, "avg_engagement": 0,
            "by_content_type": [], "by_day_of_week": [], "by_hour": [],
            "top_keywords": [], "posting_frequency": 0,
        }

    base_filter = [
        ScrapedPost.job_id.in_(job_ids),
        (ScrapedPost.created_time >= cutoff) | (ScrapedPost.created_time.is_(None)),
    ]

    # Total posts + avg engagement
    stats_result = await db.execute(
        select(
            func.count(distinct(ScrapedPost.post_id)).label("total"),
            func.avg(
                ScrapedPost.reaction_count + ScrapedPost.comment_count + ScrapedPost.share_count
            ).label("avg_eng"),
        ).where(*base_filter)
    )
    stats = stats_result.one()
    total_posts = stats.total or 0
    avg_engagement = round(float(stats.avg_eng or 0), 1)

    # By content type
    type_result = await db.execute(
        select(
            func.coalesce(ScrapedPost.attachment_type, "text").label("ctype"),
            func.count().label("cnt"),
            func.avg(ScrapedPost.reaction_count).label("avg_reactions"),
            func.avg(ScrapedPost.comment_count).label("avg_comments"),
            func.avg(ScrapedPost.share_count).label("avg_shares"),
        )
        .where(*base_filter)
        .group_by("ctype")
        .order_by(func.count().desc())
    )
    by_content_type = [
        {
            "type": row.ctype or "text",
            "count": row.cnt,
            "avg_reactions": round(float(row.avg_reactions or 0), 1),
            "avg_comments": round(float(row.avg_comments or 0), 1),
            "avg_shares": round(float(row.avg_shares or 0), 1),
        }
        for row in type_result.all()
    ]

    # By day of week
    day_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    dow_result = await db.execute(
        select(
            extract("dow", ScrapedPost.created_time).label("dow"),
            func.count().label("cnt"),
            func.avg(
                ScrapedPost.reaction_count + ScrapedPost.comment_count + ScrapedPost.share_count
            ).label("avg_eng"),
        )
        .where(*base_filter, ScrapedPost.created_time.is_not(None))
        .group_by("dow")
        .order_by("dow")
    )
    by_day = [
        {
            "day": day_names[int(row.dow)] if row.dow is not None else "Unknown",
            "count": row.cnt,
            "avg_engagement": round(float(row.avg_eng or 0), 1),
        }
        for row in dow_result.all()
    ]

    # By hour
    hour_result = await db.execute(
        select(
            extract("hour", ScrapedPost.created_time).label("hr"),
            func.count().label("cnt"),
            func.avg(
                ScrapedPost.reaction_count + ScrapedPost.comment_count + ScrapedPost.share_count
            ).label("avg_eng"),
        )
        .where(*base_filter, ScrapedPost.created_time.is_not(None))
        .group_by("hr")
        .order_by("hr")
    )
    by_hour = [
        {
            "hour": int(row.hr),
            "count": row.cnt,
            "avg_engagement": round(float(row.avg_eng or 0), 1),
        }
        for row in hour_result.all()
    ]

    # Top keywords from messages
    msg_result = await db.execute(
        select(ScrapedPost.message).where(
            *base_filter,
            ScrapedPost.message.is_not(None),
            ScrapedPost.message != "",
        ).limit(500)
    )
    messages = [r[0] for r in msg_result.all() if r[0]]
    top_keywords = _extract_keywords(messages, top_n=15)

    # Posting frequency (posts per week)
    if total_posts > 0:
        posting_frequency = round(total_posts / max(days / 7, 1), 1)
    else:
        posting_frequency = 0

    return {
        "total_posts": total_posts,
        "avg_engagement": avg_engagement,
        "by_content_type": by_content_type,
        "by_day_of_week": by_day,
        "by_hour": by_hour,
        "top_keywords": top_keywords,
        "posting_frequency": posting_frequency,
    }


# ---------------------------------------------------------------------------
# GET /trends/google-trends
# ---------------------------------------------------------------------------

@router.get("/google-trends")
async def get_google_trends(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    keywords: str | None = Query(None, description="Comma-separated keywords, max 5"),
    days: int = Query(90, ge=7, le=365),
):
    """Fetch Google Trends data for keywords, using business profile for defaults."""
    # Load business profile for defaults
    tenant_result = await db.execute(
        select(Tenant).where(Tenant.id == user.tenant_id)
    )
    tenant = tenant_result.scalar_one_or_none()
    biz = (tenant.settings or {}).get("business", {}) if tenant else {}

    country = biz.get("country", "")
    industry = biz.get("industry", "")

    # Parse keywords or auto-generate from business profile
    if keywords:
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()][:5]
    elif industry:
        kw_list = [k.strip() for k in industry.split(",")][:3]
        biz_name = biz.get("business_name", "")
        if biz_name and biz_name.lower() not in [k.lower() for k in kw_list]:
            kw_list.append(biz_name)
        kw_list = kw_list[:5]
    else:
        return {
            "keywords": [],
            "country": country,
            "interest_over_time": [],
            "related_queries": {},
            "error": "No keywords provided. Set your industry in Business Profile or provide keywords.",
        }

    from app.services.google_trends_service import GoogleTrendsService
    service = GoogleTrendsService()
    result = await service.get_trends(kw_list, country, days)
    return result


# ---------------------------------------------------------------------------
# GET /trends/source-pages — List available source pages for filtering
# ---------------------------------------------------------------------------

@router.get("/source-pages")
async def get_source_pages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all unique source pages from post discovery jobs."""
    result = await db.execute(
        select(
            ScrapingJob.input_value,
            func.count(ScrapingJob.id).label("job_count"),
            func.sum(ScrapingJob.result_row_count).label("total_posts"),
        )
        .where(
            ScrapingJob.tenant_id == user.tenant_id,
            ScrapingJob.job_type == "post_discovery",
            ScrapingJob.status.in_(["completed", "running"]),
        )
        .group_by(ScrapingJob.input_value)
        .order_by(func.sum(ScrapingJob.result_row_count).desc())
    )
    return {
        "pages": [
            {
                "input_value": r.input_value,
                "job_count": r.job_count,
                "total_posts": r.total_posts or 0,
            }
            for r in result.all()
        ]
    }
