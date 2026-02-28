"""AI-powered scoring and analysis for Facebook ad components."""

import json
import logging
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal

from openai import AsyncOpenAI
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.fb_ads import (
    FBAdAccount,
    FBAd,
    FBAdSet,
    FBCampaign,
    FBInsight,
    FBInsightScore,
    FBWinningAd,
)

logger = logging.getLogger(__name__)


async def score_ad_components(
    db: AsyncSession,
    tenant_id,
    ad_account_id,
    date_from: str,
    date_to: str,
    group_type: str = "creative",
) -> list[dict]:
    """Score ad components using AI based on aggregated performance.

    group_type: creative, headline, description, cta, interest,
                custom_audience, lookalike, location, age, gender
    """
    settings = get_settings()

    # 1. Aggregate metrics by group type
    groups = await _aggregate_by_group(db, tenant_id, ad_account_id, date_from, date_to, group_type)
    if not groups:
        return []

    # 2. Score using AI if configured, otherwise use metric-based fallback
    if settings.openai_api_key:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        scores = await _ai_score(client, groups, group_type)
    else:
        logger.info("No OpenAI API key configured, using metric-based fallback scoring")
        scores = _fallback_score_all(groups)

    # 3. Store results
    now = datetime.now(timezone.utc)
    df_date = date.fromisoformat(date_from)
    dt_date = date.fromisoformat(date_to)
    for s in scores:
        # Remove old score for same group
        old = await db.execute(
            select(FBInsightScore).where(
                FBInsightScore.tenant_id == tenant_id,
                FBInsightScore.ad_account_id == ad_account_id,
                FBInsightScore.group_type == group_type,
                FBInsightScore.group_value == s["name"],
                FBInsightScore.date_range_start == df_date,
                FBInsightScore.date_range_end == dt_date,
            )
        )
        existing = old.scalar_one_or_none()
        if existing:
            existing.score = s["score"]
            existing.metrics = s["metrics"]
            existing.scored_at = now
        else:
            db.add(FBInsightScore(
                tenant_id=tenant_id,
                ad_account_id=ad_account_id,
                group_type=group_type,
                group_value=s["name"],
                score=s["score"],
                metrics=s["metrics"],
                date_range_start=df_date,
                date_range_end=dt_date,
                scored_at=now,
            ))

    await db.flush()
    return scores


async def _aggregate_by_group(
    db: AsyncSession, tenant_id, ad_account_id, date_from: str, date_to: str, group_type: str
) -> list[dict]:
    """Aggregate performance metrics by component group type."""
    # Get all ads for this account
    ads_r = await db.execute(
        select(FBAd).join(FBAdSet).join(FBCampaign).where(
            FBCampaign.tenant_id == tenant_id,
            FBCampaign.ad_account_id == ad_account_id,
        )
    )
    ads = ads_r.scalars().all()
    if not ads:
        return []

    # Get insights for these ads
    ad_ids = [a.ad_id for a in ads]
    insight_r = await db.execute(
        select(
            FBInsight.object_id,
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.impressions).label("impressions"),
            func.sum(FBInsight.clicks).label("clicks"),
            func.sum(FBInsight.results).label("results"),
            func.sum(FBInsight.purchase_value).label("purchase_value"),
        ).where(
            FBInsight.tenant_id == tenant_id,
            FBInsight.object_type == "ad",
            FBInsight.object_id.in_(ad_ids),
            FBInsight.date >= date.fromisoformat(date_from),
            FBInsight.date <= date.fromisoformat(date_to),
        ).group_by(FBInsight.object_id)
    )
    insights_map = {row.object_id: row for row in insight_r.all()}

    # Group by component type
    groups: dict[str, dict] = {}
    for ad in ads:
        key = _extract_group_key(ad, group_type)
        if not key:
            continue
        if key not in groups:
            groups[key] = {"name": key, "spend": 0, "impressions": 0, "clicks": 0, "results": 0, "purchase_value": 0, "ad_count": 0}
        ins = insights_map.get(ad.ad_id)
        if ins:
            groups[key]["spend"] += ins.spend or 0
            groups[key]["impressions"] += ins.impressions or 0
            groups[key]["clicks"] += ins.clicks or 0
            groups[key]["results"] += ins.results or 0
            groups[key]["purchase_value"] += ins.purchase_value or 0
        groups[key]["ad_count"] += 1

    # Calculate derived metrics
    result = []
    for g in groups.values():
        spend = g["spend"]
        impressions = g["impressions"]
        clicks = g["clicks"]
        results = g["results"]
        pv = g["purchase_value"]
        g["ctr"] = round((clicks / impressions * 100) if impressions > 0 else 0, 2)
        g["cpr"] = (spend // results) if results > 0 else 0
        g["roas"] = round(pv / spend, 2) if spend > 0 else 0
        result.append(g)

    return sorted(result, key=lambda x: x["spend"], reverse=True)[:50]  # top 50


def _extract_group_key(ad: FBAd, group_type: str) -> str | None:
    """Extract the grouping key from an ad based on group type."""
    creative = ad.creative_data or {}
    if group_type == "creative":
        return creative.get("title") or creative.get("name") or ad.name
    elif group_type == "headline":
        oss = creative.get("object_story_spec", {})
        ld = oss.get("link_data", {})
        return ld.get("name") or ld.get("title") or creative.get("title")
    elif group_type == "description":
        oss = creative.get("object_story_spec", {})
        ld = oss.get("link_data", {})
        return ld.get("description") or creative.get("body")
    elif group_type == "cta":
        return creative.get("call_to_action_type") or "UNKNOWN"
    else:
        return ad.name
    return None


async def _ai_score(client: AsyncOpenAI, groups: list[dict], group_type: str) -> list[dict]:
    """Use GPT-4o to score each component 0-10."""
    components_text = "\n".join(
        f"- {g['name']}: Spend=${g['spend']/100:.2f}, CTR={g['ctr']}%, "
        f"Results={g['results']}, CPR=${g['cpr']/100:.2f}, ROAS={g['roas']}x, Ads={g['ad_count']}"
        for g in groups
    )

    prompt = f"""Score each {group_type} component on a scale of 0-10 based on its performance efficiency.
Consider: lower cost-per-result is better, higher CTR and ROAS are better, more results with less spend is efficient.
Components with no spend or results get a lower score.

Components:
{components_text}

Return a JSON array where each element has:
- "name": the component name (exactly as shown above)
- "score": number 0-10 (one decimal)

Only return the JSON array, nothing else."""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are an expert Facebook Ads performance analyst."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        content = response.choices[0].message.content or "[]"
        # Strip markdown code fences
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

        scored = json.loads(content)
    except Exception:
        logger.exception("AI scoring failed, using metric-based fallback")
        scored = []

    # Merge AI scores with metrics
    result = []
    for g in groups:
        ai_score = next((s["score"] for s in scored if s.get("name") == g["name"]), None)
        if ai_score is None:
            # Fallback: simple metric-based score
            ai_score = _fallback_score(g)
        result.append({
            "name": g["name"],
            "score": round(float(ai_score), 1),
            "metrics": {
                "spend": g["spend"],
                "impressions": g["impressions"],
                "clicks": g["clicks"],
                "ctr": g["ctr"],
                "results": g["results"],
                "cpr": g["cpr"],
                "purchase_value": g["purchase_value"],
                "roas": g["roas"],
                "ad_count": g["ad_count"],
            },
        })

    return result


def _fallback_score(g: dict) -> float:
    """Simple metric-based score when AI fails."""
    if g["spend"] == 0:
        return 0
    score = 0
    if g["ctr"] > 2:
        score += 3
    elif g["ctr"] > 1:
        score += 2
    elif g["ctr"] > 0.5:
        score += 1
    if g["results"] > 0:
        score += 3
    if g["roas"] > 2:
        score += 4
    elif g["roas"] > 1:
        score += 2
    return min(score, 10)


def _fallback_score_all(groups: list[dict]) -> list[dict]:
    """Score all groups using metric-based fallback when OpenAI is unavailable."""
    return [
        {
            "name": g["name"],
            "score": round(float(_fallback_score(g)), 1),
            "metrics": {
                "spend": g["spend"],
                "impressions": g["impressions"],
                "clicks": g["clicks"],
                "ctr": g["ctr"],
                "results": g["results"],
                "cpr": g["cpr"],
                "purchase_value": g["purchase_value"],
                "roas": g["roas"],
                "ad_count": g["ad_count"],
            },
        }
        for g in groups
    ]


# ---------------------------------------------------------------------------
# Phase 4: Winning Ads Detection
# ---------------------------------------------------------------------------

async def detect_winning_ads(db: AsyncSession, tenant_id, ad_account_id) -> list[dict]:
    """Detect top-performing ads based on ROAS, CPR, and CTR.

    Criteria:
    - Minimum $50 spend
    - Weighted formula: 0.4*roas_percentile + 0.3*cpr_inverse_percentile + 0.3*ctr_percentile
    """
    # Get all ads with sufficient spend, scoped to the selected ad account
    ads_r = await db.execute(
        select(
            FBAd,
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.impressions).label("impressions"),
            func.sum(FBInsight.clicks).label("clicks"),
            func.sum(FBInsight.results).label("results"),
            func.sum(FBInsight.purchase_value).label("purchase_value"),
        )
        .join(FBAdSet, FBAd.adset_id == FBAdSet.id)
        .join(FBCampaign, FBAdSet.campaign_id == FBCampaign.id)
        .join(FBInsight, FBInsight.object_id == FBAd.ad_id)
        .where(
            FBCampaign.tenant_id == tenant_id,
            FBCampaign.ad_account_id == ad_account_id,
            FBInsight.tenant_id == tenant_id,
            FBInsight.object_type == "ad",
        ).group_by(FBAd.id).having(
            func.sum(FBInsight.spend) >= 5000  # $50 minimum
        )
    )
    rows = ads_r.all()
    if not rows:
        return []

    # Calculate metrics and percentiles
    metrics = []
    for ad, spend, impressions, clicks, results, pv in rows:
        impressions = impressions or 0
        clicks = clicks or 0
        results = results or 0
        spend = spend or 0
        pv = pv or 0
        ctr = (clicks / impressions * 100) if impressions > 0 else 0
        cpr = (spend / results) if results > 0 else float("inf")
        roas = (pv / spend) if spend > 0 else 0
        metrics.append({
            "ad": ad,
            "spend": spend,
            "impressions": impressions,
            "clicks": clicks,
            "results": results,
            "purchase_value": pv,
            "ctr": ctr,
            "cpr": cpr,
            "roas": roas,
        })

    # Sort by each metric to get percentile ranks
    n = len(metrics)
    if n == 0:
        return []

    # ROAS percentile (higher is better)
    metrics.sort(key=lambda x: x["roas"])
    for i, m in enumerate(metrics):
        m["roas_pct"] = i / (n - 1) if n > 1 else 0.5

    # CPR inverse percentile (lower is better)
    metrics.sort(key=lambda x: x["cpr"], reverse=True)
    for i, m in enumerate(metrics):
        m["cpr_inv_pct"] = i / (n - 1) if n > 1 else 0.5

    # CTR percentile (higher is better)
    metrics.sort(key=lambda x: x["ctr"])
    for i, m in enumerate(metrics):
        m["ctr_pct"] = i / (n - 1) if n > 1 else 0.5

    # Calculate weighted score
    for m in metrics:
        m["score"] = round(
            (0.4 * m["roas_pct"] + 0.3 * m["cpr_inv_pct"] + 0.3 * m["ctr_pct"]) * 10,
            2,
        )

    # Sort by score descending, take top 10
    metrics.sort(key=lambda x: x["score"], reverse=True)
    winners = metrics[:10]

    # Upsert winning ads
    # Clear old winners
    old = await db.execute(
        select(FBWinningAd).where(FBWinningAd.tenant_id == tenant_id)
    )
    for w in old.scalars().all():
        await db.delete(w)
    await db.flush()

    now = datetime.now(timezone.utc)
    result = []
    for rank, m in enumerate(winners, 1):
        ad = m["ad"]
        winning = FBWinningAd(
            tenant_id=tenant_id,
            ad_id=ad.id,
            rank=rank,
            score=m["score"],
            total_spend=m["spend"],
            total_results=m["results"],
            cost_per_result=int(m["cpr"]) if m["cpr"] != float("inf") else 0,
            roas=Decimal(str(m["roas"])),
            ctr=Decimal(str(round(m["ctr"], 4))),
            detected_at=now,
            criteria={
                "roas_percentile": round(m["roas_pct"], 2),
                "cpr_inverse_percentile": round(m["cpr_inv_pct"], 2),
                "ctr_percentile": round(m["ctr_pct"], 2),
            },
        )
        db.add(winning)
        result.append({
            "rank": rank,
            "ad_id": str(ad.id),
            "ad_meta_id": ad.ad_id,
            "name": ad.name,
            "score": m["score"],
            "total_spend": m["spend"],
            "total_results": m["results"],
            "cost_per_result": int(m["cpr"]) if m["cpr"] != float("inf") else 0,
            "roas": round(m["roas"], 4),
            "ctr": round(m["ctr"], 4),
        })

    await db.flush()
    return result
