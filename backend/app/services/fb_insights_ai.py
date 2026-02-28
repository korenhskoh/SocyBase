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


def _percentile_ranks(values: list[float], higher_is_better: bool = True) -> list[float]:
    """Return 0-1 percentile rank for each value in the list."""
    n = len(values)
    if n <= 1:
        return [0.5] * n
    indexed = sorted(enumerate(values), key=lambda x: x[1])
    ranks = [0.0] * n
    for rank_pos, (orig_idx, _) in enumerate(indexed):
        ranks[orig_idx] = rank_pos / (n - 1)
    if not higher_is_better:
        ranks = [1.0 - r for r in ranks]
    return ranks


def _fallback_score(g: dict) -> float:
    """Single-group metric-based score (used when AI fails for one item)."""
    score = 0.0
    has_data = False

    # Impressions: any visibility is worth something
    imp = g.get("impressions", 0) or 0
    if imp > 0:
        has_data = True
        if imp >= 10000:
            score += 1.5
        elif imp >= 1000:
            score += 1.0
        elif imp > 0:
            score += 0.5

    # Clicks
    clicks = g.get("clicks", 0) or 0
    if clicks > 0:
        has_data = True
        score += min(clicks / 100, 1.5)

    # CTR
    ctr = g.get("ctr", 0) or 0
    if ctr > 2:
        score += 2.0
    elif ctr > 1:
        score += 1.5
    elif ctr > 0.5:
        score += 1.0
    elif ctr > 0:
        score += 0.5

    # Results (conversions)
    results = g.get("results", 0) or 0
    if results > 0:
        has_data = True
        score += min(results / 10, 2.0)

    # ROAS
    roas = g.get("roas", 0) or 0
    if roas > 3:
        score += 2.5
    elif roas > 2:
        score += 2.0
    elif roas > 1:
        score += 1.5
    elif roas > 0:
        score += 0.5

    # Ad count (more tested = more confidence)
    ad_count = g.get("ad_count", 0) or 0
    if ad_count >= 5:
        score += 0.5

    if not has_data:
        return 1.0  # base score for existing components with no data yet

    return round(min(score, 10.0), 1)


def _fallback_score_all(groups: list[dict]) -> list[dict]:
    """Score all groups using percentile-based ranking across available metrics.

    Uses relative comparison so components are ranked against each other,
    producing differentiated scores even when absolute values are small.
    Weights: CTR 25%, ROAS 20%, Results 20%, CPR 15% (lower better),
             Impressions 10%, Clicks 10%.
    """
    n = len(groups)
    if n == 0:
        return []

    # If only 1 group, use absolute scoring
    if n == 1:
        g = groups[0]
        return [{
            "name": g["name"],
            "score": round(float(_fallback_score(g)), 1),
            "metrics": _build_metrics(g),
        }]

    # Check if ALL metrics are zero (no data synced yet)
    total_impressions = sum(g.get("impressions", 0) or 0 for g in groups)
    total_clicks = sum(g.get("clicks", 0) or 0 for g in groups)
    total_spend = sum(g.get("spend", 0) or 0 for g in groups)
    total_results = sum(g.get("results", 0) or 0 for g in groups)

    if total_impressions == 0 and total_clicks == 0 and total_spend == 0 and total_results == 0:
        # No performance data at all — score by ad count (more ads = more tested)
        ad_counts = [g.get("ad_count", 0) or 0 for g in groups]
        ad_pcts = _percentile_ranks(ad_counts, higher_is_better=True)
        return [{
            "name": g["name"],
            "score": round(1.0 + ad_pcts[i] * 4.0, 1),  # 1.0 to 5.0 range
            "metrics": _build_metrics(g),
        } for i, g in enumerate(groups)]

    # Build metric arrays
    impressions = [float(g.get("impressions", 0) or 0) for g in groups]
    clicks = [float(g.get("clicks", 0) or 0) for g in groups]
    ctrs = [float(g.get("ctr", 0) or 0) for g in groups]
    results_list = [float(g.get("results", 0) or 0) for g in groups]
    cprs = [float(g.get("cpr", 0) or 0) for g in groups]
    roases = [float(g.get("roas", 0) or 0) for g in groups]

    # Calculate percentile ranks
    imp_pct = _percentile_ranks(impressions, higher_is_better=True)
    click_pct = _percentile_ranks(clicks, higher_is_better=True)
    ctr_pct = _percentile_ranks(ctrs, higher_is_better=True)
    results_pct = _percentile_ranks(results_list, higher_is_better=True)
    cpr_pct = _percentile_ranks(cprs, higher_is_better=False)  # lower CPR is better
    roas_pct = _percentile_ranks(roases, higher_is_better=True)

    # Determine active weights based on which metrics have variance
    weights = {}
    if max(ctrs) > 0:
        weights["ctr"] = 0.25
    if max(roases) > 0:
        weights["roas"] = 0.20
    if max(results_list) > 0:
        weights["results"] = 0.20
    if max(cprs) > 0:
        weights["cpr"] = 0.15
    if max(impressions) > 0:
        weights["impressions"] = 0.10
    if max(clicks) > 0:
        weights["clicks"] = 0.10

    # If no weights active, fall back to individual scoring
    if not weights:
        return [{
            "name": g["name"],
            "score": round(float(_fallback_score(g)), 1),
            "metrics": _build_metrics(g),
        } for g in groups]

    # Normalize weights to sum to 1.0
    total_w = sum(weights.values())
    weights = {k: v / total_w for k, v in weights.items()}

    result = []
    for i, g in enumerate(groups):
        weighted = 0.0
        if "ctr" in weights:
            weighted += weights["ctr"] * ctr_pct[i]
        if "roas" in weights:
            weighted += weights["roas"] * roas_pct[i]
        if "results" in weights:
            weighted += weights["results"] * results_pct[i]
        if "cpr" in weights:
            weighted += weights["cpr"] * cpr_pct[i]
        if "impressions" in weights:
            weighted += weights["impressions"] * imp_pct[i]
        if "clicks" in weights:
            weighted += weights["clicks"] * click_pct[i]

        # Scale 0-1 percentile to 1-10 score (minimum 1.0)
        final_score = round(1.0 + weighted * 9.0, 1)
        result.append({
            "name": g["name"],
            "score": final_score,
            "metrics": _build_metrics(g),
        })

    return result


def _build_metrics(g: dict) -> dict:
    """Build the metrics dict for a scored group."""
    return {
        "spend": g["spend"],
        "impressions": g["impressions"],
        "clicks": g["clicks"],
        "ctr": g["ctr"],
        "results": g["results"],
        "cpr": g["cpr"],
        "purchase_value": g["purchase_value"],
        "roas": g["roas"],
        "ad_count": g["ad_count"],
    }


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
