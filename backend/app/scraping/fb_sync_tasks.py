"""Celery tasks for syncing Facebook Ads data from Meta API."""

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone, date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.celery_app import celery_app
from app.database import async_session
from app.models.fb_ads import (
    FBAdAccount,
    FBAd,
    FBAdSet,
    FBCampaign,
    FBConnection,
    FBInsight,
)
from app.services.meta_api import MetaAPIService

logger = logging.getLogger(__name__)


async def _sync_fb_data(tenant_id: str) -> dict:
    """Core async function to sync all FB data for a tenant."""
    meta = MetaAPIService()
    stats = {"campaigns": 0, "adsets": 0, "ads": 0, "insights": 0}
    logger.info("[celery-sync] Starting FB sync for tenant %s", tenant_id)

    async with async_session() as db:
        # Load connection
        result = await db.execute(
            select(FBConnection).where(
                FBConnection.tenant_id == tenant_id,
                FBConnection.is_active == True,
            )
        )
        conn = result.scalar_one_or_none()
        if not conn:
            logger.info("[celery-sync] No active FB connection for tenant %s", tenant_id)
            return stats

        # Check token expiry
        if conn.token_expires_at and conn.token_expires_at < datetime.now(timezone.utc):
            logger.warning("[celery-sync] FB token expired for tenant %s", tenant_id)
            return stats

        token = meta.decrypt_token(conn.access_token_encrypted)

        # Get selected ad account
        result = await db.execute(
            select(FBAdAccount).where(
                FBAdAccount.tenant_id == tenant_id,
                FBAdAccount.is_selected == True,
            )
        )
        account = result.scalar_one_or_none()
        if not account:
            logger.info("[celery-sync] No selected ad account for tenant %s", tenant_id)
            return stats

        logger.info("[celery-sync] Syncing account %s for tenant %s", account.account_id, tenant_id)

        try:
            # 1. Sync campaigns
            campaigns = await meta.list_campaigns(token, account.account_id)
            logger.info("[celery-sync] Fetched %d campaigns from Meta", len(campaigns))
            for c in campaigns:
                existing = await db.execute(
                    select(FBCampaign).where(FBCampaign.campaign_id == c["campaign_id"])
                )
                camp = existing.scalar_one_or_none()
                if camp:
                    camp.name = c["name"]
                    camp.objective = c["objective"]
                    camp.status = c["status"]
                    camp.daily_budget = c["daily_budget"]
                    camp.lifetime_budget = c["lifetime_budget"]
                    camp.buying_type = c["buying_type"]
                    camp.raw_data = c["raw_data"]
                    camp.synced_at = datetime.now(timezone.utc)
                else:
                    camp = FBCampaign(
                        tenant_id=tenant_id,
                        ad_account_id=account.id,
                        campaign_id=c["campaign_id"],
                        name=c["name"],
                        objective=c["objective"],
                        status=c["status"],
                        daily_budget=c["daily_budget"],
                        lifetime_budget=c["lifetime_budget"],
                        buying_type=c["buying_type"],
                        raw_data=c["raw_data"],
                    )
                    db.add(camp)
                    await db.flush()
                stats["campaigns"] += 1

                # 2. Sync ad sets for each campaign
                adsets = await meta.list_adsets(token, c["campaign_id"])
                for a in adsets:
                    existing = await db.execute(
                        select(FBAdSet).where(FBAdSet.adset_id == a["adset_id"])
                    )
                    adset = existing.scalar_one_or_none()
                    if adset:
                        adset.name = a["name"]
                        adset.status = a["status"]
                        adset.daily_budget = a["daily_budget"]
                        adset.targeting = a["targeting"]
                        adset.optimization_goal = a["optimization_goal"]
                        adset.billing_event = a["billing_event"]
                        adset.bid_strategy = a["bid_strategy"]
                        adset.raw_data = a["raw_data"]
                        adset.synced_at = datetime.now(timezone.utc)
                    else:
                        adset = FBAdSet(
                            tenant_id=tenant_id,
                            campaign_id=camp.id,
                            adset_id=a["adset_id"],
                            name=a["name"],
                            status=a["status"],
                            daily_budget=a["daily_budget"],
                            targeting=a["targeting"],
                            optimization_goal=a["optimization_goal"],
                            billing_event=a["billing_event"],
                            bid_strategy=a["bid_strategy"],
                            raw_data=a["raw_data"],
                        )
                        db.add(adset)
                        await db.flush()
                    stats["adsets"] += 1

                    # 3. Sync ads for each ad set
                    ads = await meta.list_ads(token, a["adset_id"])
                    for ad_data in ads:
                        existing = await db.execute(
                            select(FBAd).where(FBAd.ad_id == ad_data["ad_id"])
                        )
                        ad = existing.scalar_one_or_none()
                        if ad:
                            ad.name = ad_data["name"]
                            ad.status = ad_data["status"]
                            ad.creative_id = ad_data["creative_id"]
                            ad.creative_data = ad_data["creative_data"]
                            ad.raw_data = ad_data["raw_data"]
                            ad.synced_at = datetime.now(timezone.utc)
                        else:
                            db.add(FBAd(
                                tenant_id=tenant_id,
                                adset_id=adset.id,
                                ad_id=ad_data["ad_id"],
                                name=ad_data["name"],
                                status=ad_data["status"],
                                creative_id=ad_data["creative_id"],
                                creative_data=ad_data["creative_data"],
                                raw_data=ad_data["raw_data"],
                            ))
                        stats["ads"] += 1

            # 4. Sync insights (last 28 days) for all levels
            date_to = date.today().isoformat()
            date_from = (date.today() - timedelta(days=28)).isoformat()

            for level in ("campaign", "adset", "ad"):
                rows = await meta.get_insights(
                    token, account.account_id, date_from, date_to, level=level
                )
                for row in rows:
                    # Upsert insight
                    existing = await db.execute(
                        select(FBInsight).where(
                            FBInsight.object_type == row["object_type"],
                            FBInsight.object_id == row["object_id"],
                            FBInsight.date == row["date"],
                        )
                    )
                    insight = existing.scalar_one_or_none()
                    if insight:
                        insight.spend = row["spend"]
                        insight.impressions = row["impressions"]
                        insight.clicks = row["clicks"]
                        insight.ctr = row["ctr"]
                        insight.cpc = row["cpc"]
                        insight.cpm = row["cpm"]
                        insight.results = row["results"]
                        insight.cost_per_result = row["cost_per_result"]
                        insight.purchase_value = row["purchase_value"]
                        insight.roas = row["roas"]
                        insight.actions = row["actions"]
                        insight.synced_at = datetime.now(timezone.utc)
                    else:
                        db.add(FBInsight(
                            tenant_id=tenant_id,
                            object_type=row["object_type"],
                            object_id=row["object_id"],
                            date=row["date"],
                            spend=row["spend"],
                            impressions=row["impressions"],
                            clicks=row["clicks"],
                            ctr=row["ctr"],
                            cpc=row["cpc"],
                            cpm=row["cpm"],
                            results=row["results"],
                            cost_per_result=row["cost_per_result"],
                            purchase_value=row["purchase_value"],
                            roas=row["roas"],
                            actions=row["actions"],
                        ))
                    stats["insights"] += 1

            logger.info("[celery-sync] Synced structure: %d campaigns, %d adsets, %d ads, %d insights for tenant %s",
                        stats["campaigns"], stats["adsets"], stats["ads"], stats["insights"], tenant_id)

            # Update last_synced_at
            conn.last_synced_at = datetime.now(timezone.utc)
            await db.commit()

        except Exception:
            logger.exception("[celery-sync] Failed to sync FB data for tenant %s", tenant_id)
            await db.rollback()
            raise

    return stats


@celery_app.task(name="app.scraping.fb_sync_tasks.sync_fb_data")
def sync_fb_data(tenant_id: str):
    """Celery task: sync FB data for a single tenant."""
    loop = asyncio.new_event_loop()
    try:
        stats = loop.run_until_complete(_sync_fb_data(tenant_id))
        logger.info("FB sync done for tenant %s: %s", tenant_id, stats)
        return stats
    finally:
        loop.close()


@celery_app.task(name="app.scraping.fb_sync_tasks.sync_all_tenants")
def sync_all_tenants():
    """Celery beat task: sync FB data for all tenants with active connections."""
    async def _gather():
        async with async_session() as db:
            result = await db.execute(
                select(FBConnection.tenant_id).where(FBConnection.is_active == True)
            )
            tenant_ids = [str(row[0]) for row in result.all()]
        return tenant_ids

    loop = asyncio.new_event_loop()
    try:
        tenant_ids = loop.run_until_complete(_gather())
    finally:
        loop.close()

    for tid in tenant_ids:
        sync_fb_data.delay(tid)

    logger.info("Dispatched FB sync for %d tenants", len(tenant_ids))
    return {"tenants_dispatched": len(tenant_ids)}


# ---------------------------------------------------------------------------
# Phase 5: AI Campaign Generation & Publishing
# ---------------------------------------------------------------------------

@celery_app.task(name="app.scraping.fb_sync_tasks.generate_ai_campaign")
def generate_ai_campaign(campaign_id: str):
    """Celery task: run AI campaign generation pipeline."""
    from app.services.ai_campaign_gen import generate_campaign

    async def _run():
        async with async_session() as db:
            return await generate_campaign(db, campaign_id)

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_run())
        logger.info("AI campaign generation done for %s: %s", campaign_id, result)
        return result
    finally:
        loop.close()


async def _run_publish(campaign_id: str) -> dict:
    """Core async publish logic — usable from Celery or inline."""
    import httpx
    from app.services.meta_api import MetaAPIService, GRAPH_BASE
    from app.models.fb_ads import (
        AICampaign, AICampaignAdSet, AICampaignAd,
        FBConnection, FBAdAccount, FBPage,
    )

    meta = MetaAPIService()

    async with async_session() as db:
        result = await db.execute(select(AICampaign).where(AICampaign.id == campaign_id))
        campaign = result.scalar_one_or_none()
        if not campaign:
            raise ValueError("Campaign not found")

        conn_r = await db.execute(
            select(FBConnection).where(
                FBConnection.tenant_id == campaign.tenant_id,
                FBConnection.is_active == True,
            )
        )
        conn = conn_r.scalar_one_or_none()
        if not conn:
            raise ValueError("No active FB connection")

        token = meta.decrypt_token(conn.access_token_encrypted)

        acc_r = await db.execute(select(FBAdAccount).where(FBAdAccount.id == campaign.ad_account_id))
        account = acc_r.scalar_one_or_none()
        if not account:
            raise ValueError("Ad account not found")

        page = None
        if campaign.page_id:
            page_r = await db.execute(select(FBPage).where(FBPage.id == campaign.page_id))
            page = page_r.scalar_one_or_none()

        campaign.status = "publishing"
        await db.flush()

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # 1. Create campaign
                resp = await client.post(
                    f"{GRAPH_BASE}/{account.account_id}/campaigns",
                    params={"access_token": token},
                    data={
                        "name": campaign.name,
                        "objective": campaign.objective.upper(),
                        "status": "PAUSED",
                        "special_ad_categories": "[]",
                    },
                )
                resp.raise_for_status()
                meta_campaign_id = resp.json().get("id")
                campaign.meta_campaign_id = meta_campaign_id

                # 2. Create ad sets
                adsets_r = await db.execute(
                    select(AICampaignAdSet).where(AICampaignAdSet.campaign_id == campaign.id)
                )
                for adset in adsets_r.scalars().all():
                    adset_data = {
                        "name": adset.name,
                        "campaign_id": meta_campaign_id,
                        "daily_budget": str(adset.daily_budget),
                        "billing_event": "IMPRESSIONS",
                        "optimization_goal": "OFFSITE_CONVERSIONS" if campaign.objective == "SALES" else "LEAD_GENERATION",
                        "status": "PAUSED",
                        "targeting": json.dumps(adset.targeting) if adset.targeting else "{}",
                    }
                    resp = await client.post(
                        f"{GRAPH_BASE}/{account.account_id}/adsets",
                        params={"access_token": token},
                        data=adset_data,
                    )
                    resp.raise_for_status()
                    meta_adset_id = resp.json().get("id")
                    adset.meta_adset_id = meta_adset_id

                    # 3. Create ads for this ad set
                    ads_r = await db.execute(
                        select(AICampaignAd).where(AICampaignAd.adset_id == adset.id)
                    )
                    for ad in ads_r.scalars().all():
                        creative_data = {
                            "name": ad.name,
                            "object_story_spec": json.dumps({
                                "page_id": page.page_id if page else "",
                                "link_data": {
                                    "message": ad.primary_text,
                                    "name": ad.headline,
                                    "description": ad.description or "",
                                    "link": ad.destination_url or campaign.landing_page_url or "",
                                    "call_to_action": {"type": ad.cta_type},
                                },
                            }),
                        }
                        resp = await client.post(
                            f"{GRAPH_BASE}/{account.account_id}/adcreatives",
                            params={"access_token": token},
                            data=creative_data,
                        )
                        resp.raise_for_status()
                        creative_id = resp.json().get("id")

                        resp = await client.post(
                            f"{GRAPH_BASE}/{account.account_id}/ads",
                            params={"access_token": token},
                            data={
                                "name": ad.name,
                                "adset_id": meta_adset_id,
                                "creative": json.dumps({"creative_id": creative_id}),
                                "status": "PAUSED",
                            },
                        )
                        resp.raise_for_status()
                        ad.meta_ad_id = resp.json().get("id")

            campaign.status = "published"
            campaign.published_at = datetime.now(timezone.utc)
            await db.commit()
            return {"status": "published", "meta_campaign_id": meta_campaign_id}

        except Exception:
            campaign.status = "failed"
            campaign.generation_progress = {"stage": "error", "pct": 0, "error": "Publishing failed — see logs."}
            await db.commit()
            raise


@celery_app.task(name="app.scraping.fb_sync_tasks.publish_ai_campaign")
def publish_ai_campaign(campaign_id: str):
    """Celery task: publish AI campaign to Meta Ads."""
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_run_publish(campaign_id))
        logger.info("AI campaign published for %s: %s", campaign_id, result)
        return result
    finally:
        loop.close()
