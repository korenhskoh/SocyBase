"""AI Campaign Generation — multi-stage pipeline to build FB ad campaigns."""

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal

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

logger = logging.getLogger(__name__)


async def generate_campaign(db: AsyncSession, campaign_id: str) -> dict:
    """Multi-stage AI campaign generation.

    Stages:
    1. Analyze (0-20%): Analyze business context and historical data
    2. Structure (20-40%): Determine campaign structure
    3. Targeting (40-60%): Generate audience targeting
    4. Creative (60-80%): Generate ad copy and creative
    5. Finalize (80-100%): Assemble complete draft
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("OpenAI API key not configured")

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    result = await db.execute(select(AICampaign).where(AICampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise ValueError(f"Campaign {campaign_id} not found")

    campaign.status = "generating"
    campaign.generation_progress = {"stage": "analyze", "pct": 0}
    await db.flush()

    try:
        # Stage 1: Analyze historical data
        campaign.generation_progress = {"stage": "analyze", "pct": 10}
        await db.flush()

        historical = await _gather_historical_data(
            db, campaign.tenant_id, campaign.ad_account_id, campaign.historical_data_range
        )

        # Stage 2: Structure
        campaign.generation_progress = {"stage": "structure", "pct": 25}
        await db.flush()

        structure = await _generate_structure(client, campaign, historical)

        # Stage 3: Targeting
        campaign.generation_progress = {"stage": "targeting", "pct": 45}
        await db.flush()

        adsets_data = await _generate_targeting(client, campaign, structure, historical)

        # Stage 4: Creative
        campaign.generation_progress = {"stage": "creative", "pct": 65}
        await db.flush()

        ads_data = await _generate_creative(client, campaign, adsets_data, historical)

        # Stage 5: Finalize
        campaign.generation_progress = {"stage": "finalize", "pct": 85}
        await db.flush()

        # Create ad set and ad records
        for adset_data in adsets_data:
            adset = AICampaignAdSet(
                campaign_id=campaign.id,
                name=adset_data["name"],
                targeting=adset_data["targeting"],
                daily_budget=adset_data["daily_budget"],
            )
            db.add(adset)
            await db.flush()

            for ad_data in ads_data.get(adset_data["name"], []):
                db.add(AICampaignAd(
                    adset_id=adset.id,
                    name=ad_data["name"],
                    headline=ad_data["headline"],
                    primary_text=ad_data["primary_text"],
                    description=ad_data.get("description", ""),
                    creative_source=ad_data.get("creative_source", "ai_generated"),
                    creative_ref_id=ad_data.get("creative_ref_id"),
                    image_url=ad_data.get("image_url"),
                    cta_type=ad_data.get("cta_type", "LEARN_MORE"),
                    destination_url=campaign.landing_page_url,
                ))

        campaign.status = "ready"
        campaign.generation_progress = {"stage": "complete", "pct": 100}
        campaign.ai_summary = {
            "num_adsets": len(adsets_data),
            "num_ads": sum(len(ads_data.get(a["name"], [])) for a in adsets_data),
            "strategy": structure.get("strategy_summary", ""),
            "total_daily_budget": campaign.daily_budget,
        }
        campaign.credits_used = 20
        await db.commit()

        return {"status": "ready", "adsets": len(adsets_data)}

    except Exception as e:
        logger.exception("Campaign generation failed for %s", campaign_id)
        campaign.status = "failed"
        campaign.generation_progress = {"stage": "error", "pct": 0, "error": str(e)}
        await db.commit()
        raise


async def _gather_historical_data(db: AsyncSession, tenant_id, ad_account_id, days: int) -> dict:
    """Gather historical performance data for AI context."""
    # Get winning ads
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

    # Get top campaigns by spend
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

    return {
        "winning_ads": winners,
        "top_campaigns": top_campaigns,
    }


async def _generate_structure(client: AsyncOpenAI, campaign: AICampaign, historical: dict) -> dict:
    """Generate campaign structure using AI."""
    context = json.dumps({
        "objective": campaign.objective,
        "daily_budget_cents": campaign.daily_budget,
        "audience_strategy": campaign.audience_strategy,
        "creative_strategy": campaign.creative_strategy,
        "landing_page": campaign.landing_page_url,
        "custom_instructions": campaign.custom_instructions,
        "historical_winners": len(historical.get("winning_ads", [])),
        "top_campaigns": historical.get("top_campaigns", []),
    }, indent=2)

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are an expert Facebook Ads campaign strategist."},
            {"role": "user", "content": f"""Design a campaign structure based on this context:
{context}

Return a JSON object with:
- "num_adsets": integer (2-4 ad sets recommended)
- "budget_split": array of percentages that sum to 100 (one per ad set)
- "ads_per_adset": integer (2-3)
- "strategy_summary": string (2-3 sentence summary of the strategy)

Only return JSON."""},
        ],
        temperature=0.4,
        max_tokens=500,
    )

    content = response.choices[0].message.content or "{}"
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3]

    try:
        return json.loads(content.strip())
    except json.JSONDecodeError:
        return {"num_adsets": 2, "budget_split": [60, 40], "ads_per_adset": 2, "strategy_summary": "Standard campaign structure."}


async def _generate_targeting(
    client: AsyncOpenAI, campaign: AICampaign, structure: dict, historical: dict
) -> list[dict]:
    """Generate targeting for each ad set."""
    num_adsets = structure.get("num_adsets", 2)
    budget_split = structure.get("budget_split", [50, 50])
    total_budget = campaign.daily_budget

    winner_targeting = [w.get("targeting", {}) for w in historical.get("winning_ads", [])]

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are an expert Facebook Ads targeting specialist."},
            {"role": "user", "content": f"""Generate {num_adsets} ad set targeting configurations.

Campaign objective: {campaign.objective}
Strategy: {campaign.audience_strategy}
Winning ad targeting patterns: {json.dumps(winner_targeting[:3])}
Custom instructions: {campaign.custom_instructions or 'None'}

Return a JSON array where each element has:
- "name": descriptive ad set name
- "targeting": object with Facebook targeting fields (age_min, age_max, genders, geo_locations, flexible_spec, etc.)

Only return JSON array."""},
        ],
        temperature=0.5,
        max_tokens=1500,
    )

    content = response.choices[0].message.content or "[]"
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content[:-3]

    try:
        adsets = json.loads(content.strip())
    except json.JSONDecodeError:
        adsets = [{"name": f"Ad Set {i+1}", "targeting": {}} for i in range(num_adsets)]

    # Assign budgets
    for i, adset in enumerate(adsets):
        pct = budget_split[i] if i < len(budget_split) else (100 // num_adsets)
        adset["daily_budget"] = int(total_budget * pct / 100)

    return adsets


async def _generate_creative(
    client: AsyncOpenAI, campaign: AICampaign, adsets: list[dict], historical: dict
) -> dict[str, list[dict]]:
    """Generate ad creative for each ad set."""
    winners = historical.get("winning_ads", [])
    winner_creatives = [
        {"headline": w.get("creative", {}).get("title", ""), "text": w.get("creative", {}).get("body", "")}
        for w in winners
    ]

    ads_per_adset = 2
    result: dict[str, list[dict]] = {}

    for adset in adsets:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are an expert Facebook Ads copywriter."},
                {"role": "user", "content": f"""Generate {ads_per_adset} ad creatives for this ad set.

Ad set: {adset['name']}
Campaign objective: {campaign.objective}
Strategy: {campaign.creative_strategy}
Landing page: {campaign.landing_page_url or 'Not specified'}
Reference winning creatives: {json.dumps(winner_creatives[:3])}
Custom instructions: {campaign.custom_instructions or 'None'}

Return a JSON array where each element has:
- "name": ad name
- "headline": short headline (max 40 chars)
- "primary_text": primary ad text (max 125 chars)
- "description": optional description
- "cta_type": one of LEARN_MORE, SIGN_UP, SHOP_NOW, GET_OFFER, CONTACT_US

Only return JSON array."""},
            ],
            temperature=0.7,
            max_tokens=1000,
        )

        content = response.choices[0].message.content or "[]"
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3]

        try:
            ads = json.loads(content.strip())
        except json.JSONDecodeError:
            ads = [
                {"name": f"Ad {j+1}", "headline": "Discover More", "primary_text": "Learn more about our offer.", "cta_type": "LEARN_MORE"}
                for j in range(ads_per_adset)
            ]

        for ad in ads:
            ad["creative_source"] = campaign.creative_strategy

        result[adset["name"]] = ads

    return result
