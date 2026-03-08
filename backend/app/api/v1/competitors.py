"""Competitor Intelligence API — track competitor pages, quick-scan, feed."""

import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.competitor import CompetitorPage
from app.models.job import ScrapingJob, ScrapedPost
from app.models.platform import Platform
from app.models.user import User
from app.scraping.clients.facebook import FacebookGraphClient
from app.scraping.post_discovery_pipeline import _extract_post_fields

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


def _virality_score(
    reactions: int, comments: int, shares: int, created_time: datetime | None,
) -> float:
    """Compute virality score with time decay (same formula as trends.py)."""
    engagement = (shares * 10) + (reactions * 2) + (comments * 3)
    if created_time:
        age_hours = max(
            (datetime.now(timezone.utc) - created_time).total_seconds() / 3600, 1,
        )
    else:
        age_hours = 24 * 30
    return round(engagement / (age_hours ** 0.3), 1)


# ---------------------------------------------------------------------------
# GET /competitors — List tracked competitors
# ---------------------------------------------------------------------------

@router.get("")
async def list_competitors(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active tracked competitor pages for this tenant."""
    result = await db.execute(
        select(CompetitorPage)
        .where(
            CompetitorPage.tenant_id == user.tenant_id,
            CompetitorPage.is_active == True,
        )
        .order_by(CompetitorPage.created_at.desc())
    )
    competitors = result.scalars().all()
    return {
        "items": [
            {
                "id": str(c.id),
                "page_id": c.page_id,
                "name": c.name,
                "category": c.category,
                "about": c.about,
                "location": c.location,
                "picture_url": c.picture_url,
                "page_url": c.page_url,
                "verification_status": c.verification_status,
                "source": c.source,
                "last_scanned_at": c.last_scanned_at.isoformat() if c.last_scanned_at else None,
                "total_posts_scanned": c.total_posts_scanned,
                "avg_engagement": c.avg_engagement,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in competitors
        ]
    }


# ---------------------------------------------------------------------------
# POST /competitors — Add a competitor
# ---------------------------------------------------------------------------

@router.post("")
async def add_competitor(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a competitor page by URL, username, or page ID."""
    input_value = body.get("input_value", "").strip()
    source = body.get("source", "manual")
    if not input_value:
        raise HTTPException(status_code=400, detail="input_value is required")

    client = FacebookGraphClient()
    try:
        parsed = client.parse_page_input(input_value)
        page_id = parsed["page_id"]

        # Check duplicate
        existing = await db.execute(
            select(CompetitorPage).where(
                CompetitorPage.tenant_id == user.tenant_id,
                CompetitorPage.page_id == page_id,
            )
        )
        existing_comp = existing.scalar_one_or_none()
        if existing_comp:
            if existing_comp.is_active:
                raise HTTPException(status_code=409, detail="Competitor already tracked")
            # Reactivate soft-deleted
            existing_comp.is_active = True
            existing_comp.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(existing_comp)
            return {"id": str(existing_comp.id), "reactivated": True}

        # Fetch metadata from AKNG
        name = body.get("name") or page_id
        category = body.get("category")
        about = body.get("about")
        picture_url = body.get("picture_url")
        page_url = body.get("page_url")
        raw_data = None

        try:
            details = await client.get_object_details(page_id)
            raw_data = details
            data = details.get("data", details) if isinstance(details, dict) else details
            name = data.get("name") or name
            category = data.get("category") or category
            about = data.get("about") or about
            pic = data.get("picture")
            if isinstance(pic, dict):
                picture_url = pic.get("data", {}).get("url") or picture_url
            elif isinstance(pic, str):
                picture_url = pic
            page_url = data.get("link") or f"https://www.facebook.com/{page_id}"
        except Exception as e:
            logger.warning(f"Failed to fetch metadata for {page_id}: {e}")
            page_url = page_url or f"https://www.facebook.com/{page_id}"

        competitor = CompetitorPage(
            tenant_id=user.tenant_id,
            page_id=page_id,
            name=name,
            category=category,
            about=about,
            picture_url=picture_url,
            page_url=page_url,
            source=source,
            raw_data=raw_data,
        )
        db.add(competitor)
        await db.commit()
        await db.refresh(competitor)

        return {
            "id": str(competitor.id),
            "page_id": competitor.page_id,
            "name": competitor.name,
            "category": competitor.category,
            "picture_url": competitor.picture_url,
            "page_url": competitor.page_url,
        }
    finally:
        await client.close()


# ---------------------------------------------------------------------------
# DELETE /competitors/{id} — Remove competitor (soft delete)
# ---------------------------------------------------------------------------

@router.delete("/{competitor_id}")
async def remove_competitor(
    competitor_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a competitor page."""
    result = await db.execute(
        select(CompetitorPage).where(
            CompetitorPage.id == competitor_id,
            CompetitorPage.tenant_id == user.tenant_id,
        )
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")

    comp.is_active = False
    comp.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /competitors/search — Search FB pages via AKNG
# ---------------------------------------------------------------------------

@router.get("/search")
async def search_pages(
    q: str = Query(..., min_length=2),
    limit: int = Query(10, ge=1, le=25),
    user: User = Depends(get_current_user),
):
    """Search Facebook pages by keyword using AKNG."""
    client = FacebookGraphClient()
    try:
        raw = await client.search_pages(q, limit=limit)
        data = raw.get("data", [])
        return {
            "results": [
                {
                    "id": p.get("id"),
                    "name": p.get("name"),
                    "link": p.get("link"),
                    "location": p.get("location"),
                    "verification_status": p.get("verification_status"),
                    "is_eligible_for_branded_content": p.get("is_eligible_for_branded_content"),
                }
                for p in data
            ]
        }
    finally:
        await client.close()


# ---------------------------------------------------------------------------
# GET /competitors/search-location — Location-aware search via Apify
# ---------------------------------------------------------------------------

@router.get("/search-location")
async def search_pages_by_location(
    q: str = Query(..., min_length=2),
    location: str = Query(..., min_length=2, description="e.g. 'Kuala Lumpur, Malaysia'"),
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user),
):
    """Search Facebook pages by keyword + location using Apify."""
    if not settings.apify_api_token:
        raise HTTPException(status_code=501, detail="Apify API token not configured")

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                "https://api.apify.com/v2/acts/curious_coder~facebook-search-scraper/run-sync-get-dataset-items",
                params={"token": settings.apify_api_token},
                json={
                    "searchType": "pages",
                    "searchQueries": [q],
                    "location": location,
                    "maxItems": limit,
                },
            )
            resp.raise_for_status()
            items = resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Apify search failed: {e.response.status_code} — {e.response.text[:500]}")
        raise HTTPException(status_code=502, detail="Location search failed")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Location search timed out")

    return {
        "results": [
            {
                "id": item.get("id") or item.get("pageId"),
                "name": item.get("name") or item.get("title"),
                "link": item.get("url") or item.get("link"),
                "location": item.get("address") or item.get("location"),
                "category": item.get("category"),
                "verification_status": item.get("verification_status"),
                "likes": item.get("likes") or item.get("likesCount"),
            }
            for item in (items if isinstance(items, list) else [])
        ]
    }


# ---------------------------------------------------------------------------
# GET /competitors/{id}/quick-scan — Live scan recent posts
# ---------------------------------------------------------------------------

@router.get("/{competitor_id}/quick-scan")
async def quick_scan(
    competitor_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch ~25 recent posts live from AKNG, rank by virality. No DB storage."""
    result = await db.execute(
        select(CompetitorPage).where(
            CompetitorPage.id == competitor_id,
            CompetitorPage.tenant_id == user.tenant_id,
            CompetitorPage.is_active == True,
        )
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")

    client = FacebookGraphClient()
    posts = []
    token_types = ["EAAAAU", "EAAGNO", "EAAD6V"]

    try:
        page_params = None
        for page_num in range(3):  # Fetch up to 3 pages (30 posts)
            raw = None
            for tt in token_types:
                try:
                    raw = await client.get_page_feed(
                        comp.page_id,
                        token_type=tt,
                        limit=10,
                        order="reverse_chronological",
                        pagination_params=page_params,
                    )
                    break
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 401:
                        continue
                    raise

            if not raw:
                break

            # Unwrap response
            inner = raw
            if "success" in raw and isinstance(raw.get("data"), dict):
                inner = raw["data"]
            if "error" in inner and isinstance(inner["error"], dict):
                break

            feed_posts = inner.get("data", [])
            if not feed_posts:
                break

            for item in feed_posts:
                fields = _extract_post_fields(item)
                score = _virality_score(
                    fields["reaction_count"], fields["comment_count"],
                    fields["share_count"], fields["created_time"],
                )
                posts.append({
                    "post_id": fields["post_id"],
                    "message": fields["message"],
                    "created_time": fields["created_time"].isoformat() if fields["created_time"] else None,
                    "from_name": fields["from_name"],
                    "comment_count": fields["comment_count"],
                    "reaction_count": fields["reaction_count"],
                    "share_count": fields["share_count"],
                    "attachment_type": fields["attachment_type"],
                    "attachment_url": fields["attachment_url"],
                    "post_url": fields["post_url"],
                    "is_livestream": fields.get("is_livestream", False),
                    "video_views": fields.get("video_views"),
                    "live_views": fields.get("live_views"),
                    "virality_score": score,
                    "engagement_total": fields["reaction_count"] + fields["comment_count"] + fields["share_count"],
                })

            # Next page
            paging = inner.get("paging", {})
            from app.scraping.post_discovery_pipeline import _next_page_params
            page_params = _next_page_params(paging)
            if not page_params:
                break

        # Sort by virality
        posts.sort(key=lambda x: x["virality_score"], reverse=True)

        # Update competitor stats
        if posts:
            total_eng = sum(p["engagement_total"] for p in posts)
            comp.avg_engagement = total_eng // len(posts) if posts else 0
            comp.total_posts_scanned = (comp.total_posts_scanned or 0) + len(posts)
        comp.last_scanned_at = datetime.now(timezone.utc)
        await db.commit()

        return {"items": posts, "total": len(posts)}
    finally:
        await client.close()


# ---------------------------------------------------------------------------
# GET /competitors/feed — Aggregated feed from stored posts
# ---------------------------------------------------------------------------

@router.get("/feed")
async def competitor_feed(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    livestream_only: bool = Query(False),
    content_type: str | None = Query(None),
    sort_by: str = Query("virality_score"),
    days: int = Query(90, ge=7, le=365),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    """Aggregated post feed from all tracked competitors' post_discovery jobs."""
    # Get active competitor page_ids
    comp_result = await db.execute(
        select(CompetitorPage.page_id).where(
            CompetitorPage.tenant_id == user.tenant_id,
            CompetitorPage.is_active == True,
        )
    )
    comp_page_ids = [r[0] for r in comp_result.all()]
    if not comp_page_ids:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Find post_discovery jobs for these page_ids
    job_result = await db.execute(
        select(ScrapingJob.id, ScrapingJob.input_value).where(
            ScrapingJob.tenant_id == user.tenant_id,
            ScrapingJob.job_type == "post_discovery",
            ScrapingJob.status.in_(["completed", "running"]),
            ScrapingJob.input_value.in_(comp_page_ids),
        )
    )
    jobs = job_result.all()
    if not jobs:
        return {"items": [], "total": 0, "page": page, "page_size": page_size}

    job_ids = [j[0] for j in jobs]
    job_input_map = {j[0]: j[1] for j in jobs}

    # Build post query
    post_filter = [
        ScrapedPost.job_id.in_(job_ids),
        (ScrapedPost.created_time >= cutoff) | (ScrapedPost.created_time.is_(None)),
    ]
    if livestream_only:
        post_filter.append(ScrapedPost.is_livestream == True)
    if content_type:
        post_filter.append(ScrapedPost.attachment_type == content_type)

    # Deduplicate by post_id
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

    # Build scored items
    items = []
    for p in all_posts:
        src = job_input_map.get(p.job_id, "unknown")
        score = _virality_score(
            p.reaction_count or 0, p.comment_count or 0,
            p.share_count or 0, p.created_time,
        )
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
            "is_livestream": p.is_livestream or False,
            "video_views": p.video_views,
            "live_views": p.live_views,
            "virality_score": score,
            "engagement_total": (p.reaction_count or 0) + (p.comment_count or 0) + (p.share_count or 0),
            "source_page": src,
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

    return {"items": paginated, "total": total, "page": page, "page_size": page_size}


# ---------------------------------------------------------------------------
# POST /competitors/{id}/scrape — Create a post_discovery job
# ---------------------------------------------------------------------------

@router.post("/{competitor_id}/scrape")
async def scrape_competitor(
    competitor_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a post_discovery scraping job for a competitor's page."""
    result = await db.execute(
        select(CompetitorPage).where(
            CompetitorPage.id == competitor_id,
            CompetitorPage.tenant_id == user.tenant_id,
            CompetitorPage.is_active == True,
        )
    )
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")

    # Get Facebook platform
    plat_result = await db.execute(
        select(Platform).where(Platform.slug == "facebook")
    )
    platform = plat_result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=500, detail="Facebook platform not found")

    job = ScrapingJob(
        tenant_id=user.tenant_id,
        user_id=user.id,
        platform_id=platform.id,
        job_type="post_discovery",
        input_type="page_url",
        input_value=comp.page_id,
        input_metadata={"competitor_id": str(comp.id), "competitor_name": comp.name},
        settings={"max_pages": 50, "token_type": "EAAAAU"},
    )
    db.add(job)
    await db.flush()

    # Update competitor reference
    comp.last_job_id = job.id
    await db.commit()

    # Dispatch Celery task
    from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
    run_post_discovery_pipeline.delay(str(job.id))

    return {
        "job_id": str(job.id),
        "competitor_id": str(comp.id),
        "status": "pending",
    }
