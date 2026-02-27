"""AI Campaign Generation — multi-stage pipeline to build FB ad campaigns."""

import json
import logging
from datetime import datetime, timezone

from openai import AsyncOpenAI
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.fb_ads import (
    AICampaign,
    AICampaignAd,
    AICampaignAdSet,
    FBAd,
    FBAdSet,
    FBCampaign,
    FBInsight,
    FBWinningAd,
)
from app.models.tenant import Tenant

logger = logging.getLogger(__name__)


def _parse_json_response(content: str, fallback):
    """Strip markdown fences and parse JSON, returning fallback on failure."""
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3]
    try:
        return json.loads(content.strip())
    except (json.JSONDecodeError, ValueError):
        return fallback


async def generate_campaign(db: AsyncSession, campaign_id: str) -> dict:
    """Multi-stage AI campaign generation pipeline.

    Stages:
    1. Analyze (0-20%): Gather business context + historical performance data
    2. Structure (20-40%): Determine campaign architecture (ad sets, budget split)
    3. Targeting (40-60%): Generate audience targeting per ad set
    4. Creative (60-80%): Generate ad copy per ad set
    5. Finalize (80-100%): Assemble complete draft with summary
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("OpenAI API key not configured")

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    result = await db.execute(select(AICampaign).where(AICampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise ValueError(f"Campaign {campaign_id} not found")

    # Delete any existing ad sets/ads from previous failed generation
    old_adsets_r = await db.execute(
        select(AICampaignAdSet).where(AICampaignAdSet.campaign_id == campaign.id)
    )
    for old_adset in old_adsets_r.scalars().all():
        await db.delete(old_adset)
    await db.flush()

    campaign.status = "generating"
    campaign.generation_progress = {"stage": "analyze", "pct": 0}
    await db.flush()

    try:
        # Stage 1: Analyze
        campaign.generation_progress = {"stage": "analyze", "pct": 10}
        await db.flush()

        historical = await _gather_historical_data(
            db, campaign.tenant_id, campaign.ad_account_id, campaign.historical_data_range
        )
        business = await _get_business_context(db, campaign.tenant_id)

        # Stage 2: Structure
        campaign.generation_progress = {"stage": "structure", "pct": 25}
        await db.flush()

        structure = await _generate_structure(client, campaign, historical, business)

        # Stage 3: Targeting
        campaign.generation_progress = {"stage": "targeting", "pct": 45}
        await db.flush()

        adsets_data = await _generate_targeting(client, campaign, structure, historical, business)

        # Stage 4: Creative
        campaign.generation_progress = {"stage": "creative", "pct": 65}
        await db.flush()

        ads_data = await _generate_creative(client, campaign, adsets_data, historical, business)

        # Stage 5: Finalize
        campaign.generation_progress = {"stage": "finalize", "pct": 85}
        await db.flush()

        total_ads = 0
        for adset_data in adsets_data:
            adset = AICampaignAdSet(
                campaign_id=campaign.id,
                name=adset_data["name"],
                targeting=adset_data.get("targeting", {}),
                daily_budget=adset_data["daily_budget"],
            )
            db.add(adset)
            await db.flush()

            for ad_data in ads_data.get(adset_data["name"], []):
                db.add(AICampaignAd(
                    adset_id=adset.id,
                    name=ad_data.get("name", f"Ad {total_ads + 1}"),
                    headline=ad_data.get("headline", "Discover More"),
                    primary_text=ad_data.get("primary_text", "Learn more about our offer."),
                    description=ad_data.get("description", ""),
                    creative_source=ad_data.get("creative_source", "ai_generated"),
                    creative_ref_id=ad_data.get("creative_ref_id"),
                    image_url=ad_data.get("image_url"),
                    cta_type=ad_data.get("cta_type", "LEARN_MORE"),
                    destination_url=campaign.landing_page_url,
                ))
                total_ads += 1

        campaign.status = "ready"
        campaign.generation_progress = {"stage": "complete", "pct": 100}
        campaign.ai_summary = {
            "num_adsets": len(adsets_data),
            "num_ads": total_ads,
            "strategy": structure.get("strategy_summary", ""),
            "total_daily_budget": campaign.daily_budget,
            "objective": campaign.objective,
            "audience_strategy": campaign.audience_strategy,
            "creative_strategy": campaign.creative_strategy,
            "historical_winners_used": len(historical.get("winning_ads", [])),
            "business_name": business.get("business_name", ""),
        }
        campaign.credits_used = 20
        await db.commit()

        return {"status": "ready", "adsets": len(adsets_data), "ads": total_ads}

    except Exception as e:
        logger.exception("Campaign generation failed for %s", campaign_id)
        campaign.status = "failed"
        campaign.generation_progress = {"stage": "error", "pct": 0, "error": str(e)}
        await db.commit()
        raise


async def _get_business_context(db: AsyncSession, tenant_id) -> dict:
    """Load tenant business profile for AI context."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant or not tenant.settings:
        return {}
    biz = tenant.settings.get("business", {})
    return {
        "business_name": biz.get("business_name", ""),
        "business_type": biz.get("business_type", ""),
        "industry": biz.get("industry", ""),
        "country": biz.get("country", ""),
        "target_audience": biz.get("target_audience_description", ""),
        "facebook_page_url": biz.get("facebook_page_url", ""),
        "product_links": biz.get("product_service_links", []),
    }


async def _gather_historical_data(db: AsyncSession, tenant_id, ad_account_id, days: int) -> dict:
    """Gather historical performance data for AI context."""
    # Get winning ads with creative + targeting
    winners_r = await db.execute(
        select(FBWinningAd, FBAd)
        .join(FBAd, FBWinningAd.ad_id == FBAd.id)
        .where(FBWinningAd.tenant_id == tenant_id)
        .order_by(FBWinningAd.rank)
        .limit(5)
    )
    winners = []
    for w, ad in winners_r.all():
        adset_r = await db.execute(select(FBAdSet).where(FBAdSet.id == ad.adset_id))
        adset = adset_r.scalar_one_or_none()
        winners.append({
            "name": ad.name,
            "creative": ad.creative_data or {},
            "targeting": adset.targeting if adset else {},
            "roas": float(w.roas),
            "ctr": float(w.ctr),
            "spend": w.total_spend,
            "results": w.total_results,
        })

    # Top campaigns by spend
    campaigns_r = await db.execute(
        select(
            FBCampaign.name,
            FBCampaign.objective,
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.results).label("results"),
        ).join(FBInsight, FBInsight.object_id == FBCampaign.campaign_id).where(
            FBCampaign.tenant_id == tenant_id,
            FBInsight.object_type == "campaign",
        ).group_by(FBCampaign.id).order_by(func.sum(FBInsight.spend).desc()).limit(5)
    )
    top_campaigns = [
        {"name": row.name, "objective": row.objective, "spend": row.spend or 0, "results": row.results or 0}
        for row in campaigns_r.all()
    ]

    # Account-level aggregated metrics for benchmarking
    totals_r = await db.execute(
        select(
            func.sum(FBInsight.spend).label("total_spend"),
            func.sum(FBInsight.results).label("total_results"),
            func.sum(FBInsight.clicks).label("total_clicks"),
            func.sum(FBInsight.impressions).label("total_impressions"),
        ).where(FBInsight.tenant_id == tenant_id)
    )
    totals = totals_r.one_or_none()
    account_metrics = {}
    if totals and totals.total_spend:
        total_spend = totals.total_spend or 1
        total_results = totals.total_results or 0
        total_clicks = totals.total_clicks or 0
        total_impressions = totals.total_impressions or 1
        account_metrics = {
            "avg_cpr_cents": total_spend // total_results if total_results else 0,
            "avg_ctr": round(total_clicks / total_impressions * 100, 2) if total_impressions else 0,
            "total_spend_cents": total_spend,
            "total_results": total_results,
        }

    return {
        "winning_ads": winners,
        "top_campaigns": top_campaigns,
        "account_metrics": account_metrics,
    }


async def _generate_structure(
    client: AsyncOpenAI, campaign: AICampaign, historical: dict, business: dict,
) -> dict:
    """Generate campaign structure using AI."""
    budget_dollars = campaign.daily_budget / 100

    context = json.dumps({
        "objective": campaign.objective,
        "daily_budget": f"${budget_dollars:.2f}",
        "audience_strategy": campaign.audience_strategy,
        "creative_strategy": campaign.creative_strategy,
        "landing_page": campaign.landing_page_url,
        "conversion_event": campaign.conversion_event,
        "custom_instructions": campaign.custom_instructions,
        "business": {k: v for k, v in business.items() if v},
        "historical_winners": len(historical.get("winning_ads", [])),
        "top_campaigns": historical.get("top_campaigns", []),
        "account_benchmarks": historical.get("account_metrics", {}),
    }, indent=2)

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": (
                "You are an expert Facebook Ads campaign strategist. "
                "You design high-performing campaign structures based on historical data and business context. "
                "Budget values in context are already in dollars."
            )},
            {"role": "user", "content": f"""Design a campaign structure for this advertiser:
{context}

Return a JSON object with:
- "num_adsets": integer (2-4 ad sets)
- "budget_split": array of percentages that sum to 100 (one per ad set)
- "ads_per_adset": integer (2-3 ads each)
- "strategy_summary": string (2-3 sentences: explain the overall strategy, why this structure, what makes it effective)
- "adset_descriptions": array of strings (one sentence per ad set explaining its purpose)

Only return valid JSON, no markdown."""},
        ],
        temperature=0.4,
        max_tokens=800,
    )

    return _parse_json_response(
        response.choices[0].message.content or "{}",
        {"num_adsets": 2, "budget_split": [60, 40], "ads_per_adset": 2, "strategy_summary": "Standard campaign structure.", "adset_descriptions": []},
    )


async def _generate_targeting(
    client: AsyncOpenAI, campaign: AICampaign, structure: dict, historical: dict, business: dict,
) -> list[dict]:
    """Generate targeting for each ad set."""
    num_adsets = structure.get("num_adsets", 2)
    budget_split = structure.get("budget_split", [50, 50])
    adset_descriptions = structure.get("adset_descriptions", [])
    total_budget = campaign.daily_budget

    winner_targeting = [w.get("targeting", {}) for w in historical.get("winning_ads", []) if w.get("targeting")]

    adset_context = ""
    for i in range(num_adsets):
        desc = adset_descriptions[i] if i < len(adset_descriptions) else f"Ad Set {i+1}"
        adset_context += f"\n- Ad Set {i+1}: {desc}"

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": (
                "You are an expert Facebook Ads targeting specialist. "
                "Generate targeting configurations that are valid for the Facebook Marketing API. "
                "Use proper Facebook targeting format: geo_locations with countries/cities, "
                "age_min/age_max (18-65), genders (1=Male, 2=Female, 0=All), "
                "and flexible_spec for interest targeting with {interests: [{id, name}]}."
            )},
            {"role": "user", "content": f"""Generate {num_adsets} ad set targeting configurations.

Business: {json.dumps({k: v for k, v in business.items() if v}) if business else 'Not specified'}
Campaign objective: {campaign.objective}
Audience strategy: {campaign.audience_strategy} ({'Use proven patterns from winning ads' if campaign.audience_strategy == 'conservative' else 'Explore new audience segments'})
Ad set purposes: {adset_context}
Winning ad targeting patterns: {json.dumps(winner_targeting[:3]) if winner_targeting else 'No historical data'}
Custom instructions: {campaign.custom_instructions or 'None'}

Return a JSON array where each element has:
- "name": descriptive ad set name (e.g., "Women 25-45 - Skincare Interest")
- "targeting": object with Facebook API fields: age_min, age_max, genders, geo_locations, flexible_spec

Only return valid JSON array, no markdown."""},
        ],
        temperature=0.5,
        max_tokens=2000,
    )

    adsets = _parse_json_response(
        response.choices[0].message.content or "[]",
        [{"name": f"Ad Set {i+1}", "targeting": {}} for i in range(num_adsets)],
    )

    # Ensure it's a list
    if not isinstance(adsets, list):
        adsets = [{"name": f"Ad Set {i+1}", "targeting": {}} for i in range(num_adsets)]

    # Assign budgets
    for i, adset in enumerate(adsets):
        pct = budget_split[i] if i < len(budget_split) else (100 // max(num_adsets, 1))
        adset["daily_budget"] = int(total_budget * pct / 100)
        if "targeting" not in adset:
            adset["targeting"] = {}

    return adsets


async def _generate_creative(
    client: AsyncOpenAI, campaign: AICampaign, adsets: list[dict], historical: dict, business: dict,
) -> dict[str, list[dict]]:
    """Generate ad creative for each ad set."""
    winners = historical.get("winning_ads", [])
    winner_creatives = []
    for w in winners:
        creative = w.get("creative", {})
        # Extract creative text from different possible structures
        headline = creative.get("title") or creative.get("name") or ""
        text = creative.get("body") or creative.get("message") or ""
        if headline or text:
            winner_creatives.append({"headline": headline, "text": text, "roas": w.get("roas", 0)})

    ads_per_adset = max(2, min(structure_ads := len(adsets), 3)) if adsets else 2
    result: dict[str, list[dict]] = {}

    biz_context = ""
    if business:
        parts = []
        if business.get("business_name"):
            parts.append(f"Business: {business['business_name']}")
        if business.get("industry"):
            parts.append(f"Industry: {business['industry']}")
        if business.get("target_audience"):
            parts.append(f"Target audience: {business['target_audience']}")
        biz_context = "\n".join(parts) if parts else ""

    for adset in adsets:
        targeting_summary = ""
        t = adset.get("targeting", {})
        if t.get("age_min"):
            targeting_summary += f"Age {t['age_min']}-{t.get('age_max', 65)}. "
        if t.get("genders"):
            g = t["genders"]
            if isinstance(g, list):
                targeting_summary += f"Gender: {', '.join('Male' if x == 1 else 'Female' for x in g)}. "

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": (
                    "You are an expert Facebook Ads copywriter who creates high-converting ad copy. "
                    "Write compelling, concise copy that drives action. "
                    "Match the tone to the audience and objective."
                )},
                {"role": "user", "content": f"""Generate {ads_per_adset} Facebook ad creatives.

Ad set: {adset['name']}
Audience: {targeting_summary or 'Broad audience'}
Campaign objective: {campaign.objective}
Creative strategy: {campaign.creative_strategy} ({'Reference proven winners' if campaign.creative_strategy == 'proven_winners' else 'Create fresh, original copy'})
Landing page: {campaign.landing_page_url or 'Not specified'}
{biz_context}
{f'Reference winning ad copy (these performed well): {json.dumps(winner_creatives[:3])}' if winner_creatives else ''}
Custom instructions: {campaign.custom_instructions or 'None'}

Return a JSON array where each element has:
- "name": descriptive ad name (e.g., "Lead Gen - Benefit Focus")
- "headline": compelling headline (max 40 chars, no emojis)
- "primary_text": ad body text (max 125 chars, persuasive and clear)
- "description": link description (max 30 chars, optional)
- "cta_type": one of LEARN_MORE, SIGN_UP, SHOP_NOW, GET_OFFER, CONTACT_US

Only return valid JSON array, no markdown."""},
            ],
            temperature=0.7,
            max_tokens=1200,
        )

        ads = _parse_json_response(
            response.choices[0].message.content or "[]",
            [
                {"name": f"Ad {j+1}", "headline": "Discover More", "primary_text": "Learn more about our offer.", "cta_type": "LEARN_MORE"}
                for j in range(ads_per_adset)
            ],
        )

        if not isinstance(ads, list):
            ads = [
                {"name": f"Ad {j+1}", "headline": "Discover More", "primary_text": "Learn more about our offer.", "cta_type": "LEARN_MORE"}
                for j in range(ads_per_adset)
            ]

        for ad in ads:
            ad["creative_source"] = campaign.creative_strategy

        result[adset["name"]] = ads

    return result
