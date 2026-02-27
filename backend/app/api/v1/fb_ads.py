"""Facebook Ads integration — OAuth connection, account selection, performance, and management."""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, update, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.fb_ads import (
    FBAdAccount, FBConnection, FBPage, FBPixel,
    FBCampaign, FBAdSet, FBAd, FBInsight,
    FBInsightScore, FBWinningAd,
    AICampaign, AICampaignAdSet, AICampaignAd,
)
from app.models.user import User
from app.models.job import ScrapingJob, ScrapedProfile
from app.models.credit import CreditBalance, CreditTransaction
from app.services.meta_api import MetaAPIService

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SelectRequest(BaseModel):
    id: str  # UUID as string


class ConnectionResponse(BaseModel):
    connected: bool
    fb_user_name: str | None = None
    fb_user_id: str | None = None
    connected_at: str | None = None
    last_synced_at: str | None = None


class AdAccountResponse(BaseModel):
    id: str
    account_id: str
    name: str
    currency: str
    timezone_name: str
    status: str
    is_selected: bool


class PageResponse(BaseModel):
    id: str
    page_id: str
    name: str
    category: str | None = None
    picture_url: str | None = None
    is_selected: bool


class PixelResponse(BaseModel):
    id: str
    pixel_id: str
    name: str
    is_selected: bool


# Phase 2 schemas

class CampaignResponse(BaseModel):
    id: str
    campaign_id: str
    name: str
    objective: str | None = None
    status: str
    daily_budget: int | None = None
    lifetime_budget: int | None = None
    spend: int = 0
    impressions: int = 0
    clicks: int = 0
    ctr: float = 0
    results: int = 0
    cost_per_result: int = 0
    purchase_value: int = 0
    roas: float = 0
    synced_at: str | None = None


class AdSetResponse(BaseModel):
    id: str
    adset_id: str
    campaign_id: str
    name: str
    status: str
    daily_budget: int | None = None
    targeting: dict = {}
    optimization_goal: str | None = None
    spend: int = 0
    impressions: int = 0
    clicks: int = 0
    ctr: float = 0
    results: int = 0
    cost_per_result: int = 0
    purchase_value: int = 0
    roas: float = 0


class AdResponse(BaseModel):
    id: str
    ad_id: str
    adset_id: str
    name: str
    status: str
    creative_id: str | None = None
    creative_data: dict = {}
    spend: int = 0
    impressions: int = 0
    clicks: int = 0
    ctr: float = 0
    results: int = 0
    cost_per_result: int = 0
    purchase_value: int = 0
    roas: float = 0


class InsightSummary(BaseModel):
    total_spend: int = 0
    total_impressions: int = 0
    total_clicks: int = 0
    avg_ctr: float = 0
    total_results: int = 0
    avg_cost_per_result: int = 0
    total_purchase_value: int = 0
    avg_roas: float = 0


class StatusUpdateRequest(BaseModel):
    status: str  # ACTIVE, PAUSED


# Phase 3 & 4 schemas

class InsightScoreResponse(BaseModel):
    id: str
    group_type: str
    group_value: str
    score: float
    metrics: dict
    date_range_start: str
    date_range_end: str


class ScoreRequest(BaseModel):
    group_type: str = "creative"
    date_from: str | None = None
    date_to: str | None = None


class WinningAdResponse(BaseModel):
    id: str
    rank: int
    score: float
    ad_id: str
    ad_name: str
    ad_meta_id: str
    ad_status: str
    creative_data: dict
    targeting: dict
    total_spend: int
    total_results: int
    cost_per_result: int
    roas: float
    ctr: float
    detected_at: str


# Custom Audience schemas

class CreateCustomAudienceRequest(BaseModel):
    job_id: str  # scraping job UUID
    audience_name: str | None = None  # optional custom name


# Phase 5 schemas

class CreateCampaignRequest(BaseModel):
    name: str
    objective: str  # LEADS, SALES
    daily_budget: int  # in cents
    page_id: str | None = None
    pixel_id: str | None = None
    conversion_event: str | None = None
    landing_page_url: str | None = None
    audience_strategy: str = "conservative"
    creative_strategy: str = "proven_winners"
    historical_data_range: int = 90
    custom_instructions: str | None = None


class AICampaignAdResponse(BaseModel):
    id: str
    name: str
    headline: str
    primary_text: str
    description: str | None = None
    creative_source: str
    cta_type: str
    destination_url: str | None = None


class AICampaignAdSetResponse(BaseModel):
    id: str
    name: str
    targeting: dict
    daily_budget: int
    ads: list[AICampaignAdResponse] = []


class AICampaignResponse(BaseModel):
    id: str
    status: str
    name: str
    objective: str
    daily_budget: int
    landing_page_url: str | None = None
    conversion_event: str | None = None
    audience_strategy: str
    creative_strategy: str
    custom_instructions: str | None = None
    ai_summary: dict | None = None
    generation_progress: dict | None = None
    credits_used: int
    meta_campaign_id: str | None = None
    published_at: str | None = None
    created_at: str
    adsets: list[AICampaignAdSetResponse] = []


class UpdateCampaignRequest(BaseModel):
    """Edit a campaign draft before publishing."""
    name: str | None = None
    daily_budget: int | None = None
    landing_page_url: str | None = None
    conversion_event: str | None = None
    custom_instructions: str | None = None
    adsets: list[dict] | None = None  # [{id, name, daily_budget, targeting, ads: [{id, headline, primary_text, description, cta_type}]}]


# ---------------------------------------------------------------------------
# OAuth flow
# ---------------------------------------------------------------------------

@router.get("/connect/url")
async def get_connect_url(user: User = Depends(get_current_user)):
    """Return the Facebook OAuth URL for the frontend to redirect to."""
    settings = get_settings()
    if not settings.meta_app_id:
        raise HTTPException(status_code=400, detail="Meta App ID not configured. Set META_APP_ID env var.")
    meta = MetaAPIService()
    state = str(user.tenant_id)
    return {"url": meta.get_oauth_url(state=state)}


@router.get("/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """Handle Facebook OAuth callback — exchange code, store long-lived token."""
    settings = get_settings()
    if not settings.meta_app_id or not settings.meta_app_secret:
        raise HTTPException(status_code=400, detail="Meta API credentials not configured.")

    meta = MetaAPIService()

    # Exchange code for short-lived token
    token_data = await meta.exchange_code(code)
    short_token = token_data["access_token"]

    # Exchange for long-lived token
    long_data = await meta.get_long_lived_token(short_token)
    long_token = long_data["access_token"]
    expires_at = long_data.get("expires_at")

    # Get user info
    fb_user = await meta.get_user_info(long_token)

    # Resolve tenant_id from state
    tenant_id = uuid.UUID(state) if state else None
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Invalid OAuth state — missing tenant ID.")

    # Find a user in this tenant to attribute connection to
    result = await db.execute(select(User).where(User.tenant_id == tenant_id).limit(1))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Tenant not found.")

    # Upsert connection (one per tenant)
    result = await db.execute(select(FBConnection).where(FBConnection.tenant_id == tenant_id))
    conn = result.scalar_one_or_none()
    if conn:
        conn.access_token_encrypted = meta.encrypt_token(long_token)
        conn.token_expires_at = expires_at
        conn.fb_user_id = fb_user["id"]
        conn.fb_user_name = fb_user.get("name", "")
        conn.is_active = True
    else:
        conn = FBConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            access_token_encrypted=meta.encrypt_token(long_token),
            token_expires_at=expires_at,
            fb_user_id=fb_user["id"],
            fb_user_name=fb_user.get("name", ""),
            scopes=meta.get_oauth_url.__func__  # placeholder
        )
        conn.scopes = ["ads_management", "ads_read", "business_management", "pages_read_engagement", "pages_show_list"]
        db.add(conn)

    await db.flush()

    # Sync ad accounts
    accounts = await meta.list_ad_accounts(long_token)
    for acc in accounts:
        existing = await db.execute(
            select(FBAdAccount).where(
                FBAdAccount.tenant_id == tenant_id,
                FBAdAccount.account_id == acc["account_id"],
            )
        )
        if not existing.scalar_one_or_none():
            db.add(FBAdAccount(
                tenant_id=tenant_id,
                connection_id=conn.id,
                account_id=acc["account_id"],
                name=acc["name"],
                currency=acc["currency"],
                timezone_name=acc["timezone_name"],
                status=acc["status"],
            ))

    # Sync pages
    pages = await meta.list_pages(long_token)
    for pg in pages:
        existing = await db.execute(
            select(FBPage).where(FBPage.tenant_id == tenant_id, FBPage.page_id == pg["page_id"])
        )
        if not existing.scalar_one_or_none():
            page_token_enc = meta.encrypt_token(pg["access_token"]) if pg.get("access_token") else None
            db.add(FBPage(
                tenant_id=tenant_id,
                connection_id=conn.id,
                page_id=pg["page_id"],
                name=pg["name"],
                category=pg.get("category"),
                picture_url=pg.get("picture_url"),
                access_token_encrypted=page_token_enc,
            ))

    await db.commit()

    # Redirect back to frontend
    frontend_url = settings.frontend_url.rstrip("/")
    return RedirectResponse(url=f"{frontend_url}/fb-ads/connect?connected=true")


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

@router.get("/connection")
async def get_connection(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConnectionResponse:
    """Get current Facebook connection status."""
    result = await db.execute(
        select(FBConnection).where(FBConnection.tenant_id == user.tenant_id, FBConnection.is_active == True)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return ConnectionResponse(connected=False)
    return ConnectionResponse(
        connected=True,
        fb_user_name=conn.fb_user_name,
        fb_user_id=conn.fb_user_id,
        connected_at=conn.connected_at.isoformat() if conn.connected_at else None,
        last_synced_at=conn.last_synced_at.isoformat() if conn.last_synced_at else None,
    )


@router.delete("/connection")
async def disconnect(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disconnect Facebook — deactivate connection and clear tokens."""
    result = await db.execute(
        select(FBConnection).where(FBConnection.tenant_id == user.tenant_id, FBConnection.is_active == True)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="No active connection.")
    conn.is_active = False
    conn.access_token_encrypted = ""
    await db.commit()
    return {"detail": "Disconnected successfully."}


@router.get("/debug-token")
async def debug_token(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Debug endpoint: test each Meta API call the sync makes, one by one."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not conn:
        return {"error": "No active connection"}

    meta = MetaAPIService()

    try:
        token = meta.decrypt_token(conn.access_token_encrypted)
    except Exception as e:
        return {"error": f"Token decryption failed: {e}"}

    # Verify what _auth_params actually returns (to confirm appsecret_proof is gone)
    auth = meta._auth_params(token)
    diag: dict = {
        "auth_params_keys": list(auth.keys()),
        "ad_account_id": account.account_id if account else None,
    }

    if not account:
        return diag

    base = "https://graph.facebook.com/v22.0"
    campaign_fields = "id,name,objective,status,daily_budget,lifetime_budget,buying_type,created_time,updated_time"
    adset_fields = "id,name,status,daily_budget,targeting,optimization_goal,billing_event,bid_strategy,start_time,end_time"
    ad_fields = "id,name,status,creative{id,title,body,image_url,video_id,call_to_action_type,object_story_spec,effective_object_story_id,thumbnail_url,link_url}"

    async with httpx.AsyncClient(timeout=20) as client:
        # Test 1: campaigns with FULL fields (same as sync)
        try:
            r = await client.get(
                f"{base}/{account.account_id}/campaigns",
                params={"access_token": token, "fields": campaign_fields, "limit": 5},
            )
            diag["1_campaigns"] = {"status": r.status_code, "body": r.json()}
        except Exception as e:
            diag["1_campaigns"] = {"error": str(e)}

        # Get first campaign ID for next tests
        first_campaign_id = None
        try:
            first_campaign_id = diag["1_campaigns"]["body"]["data"][0]["id"]
        except (KeyError, IndexError, TypeError):
            pass

        # Test 2: adsets with FULL fields
        if first_campaign_id:
            try:
                r = await client.get(
                    f"{base}/{first_campaign_id}/adsets",
                    params={"access_token": token, "fields": adset_fields, "limit": 5},
                )
                diag["2_adsets"] = {"status": r.status_code, "body": r.json()}
            except Exception as e:
                diag["2_adsets"] = {"error": str(e)}

            # Get first adset ID
            first_adset_id = None
            try:
                first_adset_id = diag["2_adsets"]["body"]["data"][0]["id"]
            except (KeyError, IndexError, TypeError):
                pass

            # Test 3: ads with FULL fields
            if first_adset_id:
                try:
                    r = await client.get(
                        f"{base}/{first_adset_id}/ads",
                        params={"access_token": token, "fields": ad_fields, "limit": 5},
                    )
                    diag["3_ads"] = {"status": r.status_code, "body": r.json()}
                except Exception as e:
                    diag["3_ads"] = {"error": str(e)}

        # Test 4: insights
        date_to = date.today().isoformat()
        date_from = (date.today() - timedelta(days=7)).isoformat()
        try:
            r = await client.get(
                f"{base}/{account.account_id}/insights",
                params={
                    "access_token": token,
                    "level": "campaign",
                    "time_range": f'{{"since":"{date_from}","until":"{date_to}"}}',
                    "time_increment": 1,
                    "fields": "campaign_id,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,date_start",
                    "limit": 5,
                },
            )
            diag["4_insights"] = {"status": r.status_code, "body": r.json()}
        except Exception as e:
            diag["4_insights"] = {"error": str(e)}

        # Test 5: call list_campaigns through meta_api (uses _auth_params)
        try:
            result = await meta.list_campaigns(token, account.account_id)
            diag["5_meta_api_list_campaigns"] = {"ok": True, "count": len(result)}
        except Exception as e:
            diag["5_meta_api_list_campaigns"] = {"error": str(e), "type": type(e).__name__}

    return diag


# ---------------------------------------------------------------------------
# Ad Accounts
# ---------------------------------------------------------------------------

@router.get("/ad-accounts")
async def list_ad_accounts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AdAccountResponse]:
    result = await db.execute(
        select(FBAdAccount).where(FBAdAccount.tenant_id == user.tenant_id)
    )
    accounts = result.scalars().all()
    return [
        AdAccountResponse(
            id=str(a.id),
            account_id=a.account_id,
            name=a.name,
            currency=a.currency,
            timezone_name=a.timezone_name,
            status=a.status,
            is_selected=a.is_selected,
        )
        for a in accounts
    ]


@router.post("/ad-accounts/select")
async def select_ad_account(
    body: SelectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Select an ad account as the active one for this tenant."""
    # Deselect all first
    await db.execute(
        update(FBAdAccount)
        .where(FBAdAccount.tenant_id == user.tenant_id)
        .values(is_selected=False)
    )
    # Select the chosen one
    result = await db.execute(
        select(FBAdAccount).where(
            FBAdAccount.tenant_id == user.tenant_id,
            FBAdAccount.id == uuid.UUID(body.id),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Ad account not found.")
    account.is_selected = True

    # Also sync pixels for this account
    conn_result = await db.execute(
        select(FBConnection).where(FBConnection.tenant_id == user.tenant_id, FBConnection.is_active == True)
    )
    conn = conn_result.scalar_one_or_none()
    if conn:
        meta = MetaAPIService()
        token = meta.decrypt_token(conn.access_token_encrypted)
        try:
            pixels = await meta.list_pixels(token, account.account_id)
            for px in pixels:
                existing = await db.execute(
                    select(FBPixel).where(FBPixel.tenant_id == user.tenant_id, FBPixel.pixel_id == px["pixel_id"])
                )
                if not existing.scalar_one_or_none():
                    db.add(FBPixel(
                        tenant_id=user.tenant_id,
                        ad_account_id=account.id,
                        pixel_id=px["pixel_id"],
                        name=px["name"],
                    ))
        except Exception as e:
            logger.warning("Failed to sync pixels: %s", e)

    await db.commit()
    return {"detail": "Ad account selected.", "account_id": account.account_id}


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@router.get("/pages")
async def list_pages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PageResponse]:
    result = await db.execute(
        select(FBPage).where(FBPage.tenant_id == user.tenant_id)
    )
    pages = result.scalars().all()
    return [
        PageResponse(
            id=str(p.id),
            page_id=p.page_id,
            name=p.name,
            category=p.category,
            picture_url=p.picture_url,
            is_selected=p.is_selected,
        )
        for p in pages
    ]


@router.post("/pages/select")
async def select_page(
    body: SelectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(FBPage).where(FBPage.tenant_id == user.tenant_id).values(is_selected=False)
    )
    result = await db.execute(
        select(FBPage).where(FBPage.tenant_id == user.tenant_id, FBPage.id == uuid.UUID(body.id))
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found.")
    page.is_selected = True
    await db.commit()
    return {"detail": "Page selected.", "page_id": page.page_id}


# ---------------------------------------------------------------------------
# Pixels
# ---------------------------------------------------------------------------

@router.get("/pixels")
async def list_pixels(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PixelResponse]:
    # Get selected ad account
    acc_result = await db.execute(
        select(FBAdAccount).where(FBAdAccount.tenant_id == user.tenant_id, FBAdAccount.is_selected == True)
    )
    account = acc_result.scalar_one_or_none()
    if not account:
        return []

    result = await db.execute(
        select(FBPixel).where(FBPixel.tenant_id == user.tenant_id, FBPixel.ad_account_id == account.id)
    )
    pixels = result.scalars().all()
    return [
        PixelResponse(
            id=str(px.id),
            pixel_id=px.pixel_id,
            name=px.name,
            is_selected=px.is_selected,
        )
        for px in pixels
    ]


@router.post("/pixels/select")
async def select_pixel(
    body: SelectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Deselect all pixels for this tenant
    await db.execute(
        update(FBPixel).where(FBPixel.tenant_id == user.tenant_id).values(is_selected=False)
    )
    result = await db.execute(
        select(FBPixel).where(FBPixel.tenant_id == user.tenant_id, FBPixel.id == uuid.UUID(body.id))
    )
    pixel = result.scalar_one_or_none()
    if not pixel:
        raise HTTPException(status_code=404, detail="Pixel not found.")
    pixel.is_selected = True
    await db.commit()
    return {"detail": "Pixel selected.", "pixel_id": pixel.pixel_id}


# ---------------------------------------------------------------------------
# Phase 2: Performance Dashboard
# ---------------------------------------------------------------------------

def _default_date_range(date_from: str | None, date_to: str | None) -> tuple[date, date]:
    """Return (date_from, date_to) as date objects, defaulting to last 28 days."""
    dt = date.fromisoformat(date_to) if date_to else date.today()
    df = date.fromisoformat(date_from) if date_from else (date.today() - timedelta(days=28))
    return df, dt


async def _get_active_connection(db: AsyncSession, tenant_id) -> tuple[FBConnection | None, FBAdAccount | None]:
    """Return the active connection and selected ad account for a tenant."""
    conn_r = await db.execute(
        select(FBConnection).where(FBConnection.tenant_id == tenant_id, FBConnection.is_active == True)
    )
    conn = conn_r.scalar_one_or_none()
    acc_r = await db.execute(
        select(FBAdAccount).where(FBAdAccount.tenant_id == tenant_id, FBAdAccount.is_selected == True)
    )
    account = acc_r.scalar_one_or_none()
    return conn, account


@router.get("/campaigns")
async def list_campaigns(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CampaignResponse]:
    """List campaigns with aggregated insights."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not account:
        return []

    df, dt = _default_date_range(date_from, date_to)

    result = await db.execute(
        select(FBCampaign).where(
            FBCampaign.tenant_id == user.tenant_id,
            FBCampaign.ad_account_id == account.id,
        ).order_by(FBCampaign.created_at.desc())
    )
    campaigns = result.scalars().all()

    # Aggregate insights per campaign
    insight_r = await db.execute(
        select(
            FBInsight.object_id,
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.impressions).label("impressions"),
            func.sum(FBInsight.clicks).label("clicks"),
            func.sum(FBInsight.results).label("results"),
            func.sum(FBInsight.purchase_value).label("purchase_value"),
        ).where(
            FBInsight.tenant_id == user.tenant_id,
            FBInsight.object_type == "campaign",
            FBInsight.date >= df,
            FBInsight.date <= dt,
        ).group_by(FBInsight.object_id)
    )
    insights_map = {}
    for row in insight_r.all():
        spend = row.spend or 0
        clicks = row.clicks or 0
        impressions = row.impressions or 0
        results = row.results or 0
        pv = row.purchase_value or 0
        insights_map[row.object_id] = {
            "spend": spend,
            "impressions": impressions,
            "clicks": clicks,
            "ctr": round((clicks / impressions * 100) if impressions > 0 else 0, 2),
            "results": results,
            "cost_per_result": (spend // results) if results > 0 else 0,
            "purchase_value": pv,
            "roas": round(pv / spend, 2) if spend > 0 else 0,
        }

    return [
        CampaignResponse(
            id=str(c.id),
            campaign_id=c.campaign_id,
            name=c.name,
            objective=c.objective,
            status=c.status,
            daily_budget=c.daily_budget,
            lifetime_budget=c.lifetime_budget,
            synced_at=c.synced_at.isoformat() if c.synced_at else None,
            **insights_map.get(c.campaign_id, {}),
        )
        for c in campaigns
    ]


@router.get("/campaigns/{campaign_db_id}/adsets")
async def list_campaign_adsets(
    campaign_db_id: str,
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AdSetResponse]:
    """List ad sets for a campaign with aggregated insights."""
    df, dt = _default_date_range(date_from, date_to)

    result = await db.execute(
        select(FBAdSet).where(
            FBAdSet.tenant_id == user.tenant_id,
            FBAdSet.campaign_id == uuid.UUID(campaign_db_id),
        )
    )
    adsets = result.scalars().all()

    adset_meta_ids = [a.adset_id for a in adsets]
    insight_r = await db.execute(
        select(
            FBInsight.object_id,
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.impressions).label("impressions"),
            func.sum(FBInsight.clicks).label("clicks"),
            func.sum(FBInsight.results).label("results"),
            func.sum(FBInsight.purchase_value).label("purchase_value"),
        ).where(
            FBInsight.tenant_id == user.tenant_id,
            FBInsight.object_type == "adset",
            FBInsight.object_id.in_(adset_meta_ids),
            FBInsight.date >= df,
            FBInsight.date <= dt,
        ).group_by(FBInsight.object_id)
    )
    insights_map = {}
    for row in insight_r.all():
        spend = row.spend or 0
        clicks = row.clicks or 0
        impressions = row.impressions or 0
        results = row.results or 0
        pv = row.purchase_value or 0
        insights_map[row.object_id] = {
            "spend": spend, "impressions": impressions, "clicks": clicks,
            "ctr": round((clicks / impressions * 100) if impressions > 0 else 0, 2),
            "results": results,
            "cost_per_result": (spend // results) if results > 0 else 0,
            "purchase_value": pv,
            "roas": round(pv / spend, 2) if spend > 0 else 0,
        }

    return [
        AdSetResponse(
            id=str(a.id),
            adset_id=a.adset_id,
            campaign_id=str(a.campaign_id),
            name=a.name,
            status=a.status,
            daily_budget=a.daily_budget,
            targeting=a.targeting or {},
            optimization_goal=a.optimization_goal,
            **insights_map.get(a.adset_id, {}),
        )
        for a in adsets
    ]


@router.get("/adsets/{adset_db_id}/ads")
async def list_adset_ads(
    adset_db_id: str,
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AdResponse]:
    """List ads for an ad set with aggregated insights."""
    df, dt = _default_date_range(date_from, date_to)

    result = await db.execute(
        select(FBAd).where(
            FBAd.tenant_id == user.tenant_id,
            FBAd.adset_id == uuid.UUID(adset_db_id),
        )
    )
    ads = result.scalars().all()

    ad_meta_ids = [a.ad_id for a in ads]
    insight_r = await db.execute(
        select(
            FBInsight.object_id,
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.impressions).label("impressions"),
            func.sum(FBInsight.clicks).label("clicks"),
            func.sum(FBInsight.results).label("results"),
            func.sum(FBInsight.purchase_value).label("purchase_value"),
        ).where(
            FBInsight.tenant_id == user.tenant_id,
            FBInsight.object_type == "ad",
            FBInsight.object_id.in_(ad_meta_ids),
            FBInsight.date >= df,
            FBInsight.date <= dt,
        ).group_by(FBInsight.object_id)
    )
    insights_map = {}
    for row in insight_r.all():
        spend = row.spend or 0
        clicks = row.clicks or 0
        impressions = row.impressions or 0
        results = row.results or 0
        pv = row.purchase_value or 0
        insights_map[row.object_id] = {
            "spend": spend, "impressions": impressions, "clicks": clicks,
            "ctr": round((clicks / impressions * 100) if impressions > 0 else 0, 2),
            "results": results,
            "cost_per_result": (spend // results) if results > 0 else 0,
            "purchase_value": pv,
            "roas": round(pv / spend, 2) if spend > 0 else 0,
        }

    return [
        AdResponse(
            id=str(a.id),
            ad_id=a.ad_id,
            adset_id=str(a.adset_id),
            name=a.name,
            status=a.status,
            creative_id=a.creative_id,
            creative_data=a.creative_data or {},
            **insights_map.get(a.ad_id, {}),
        )
        for a in ads
    ]


@router.get("/insights/summary")
async def get_insights_summary(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InsightSummary:
    """Get aggregated insight summary for the selected ad account."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not account:
        return InsightSummary()

    df, dt = _default_date_range(date_from, date_to)

    result = await db.execute(
        select(
            func.sum(FBInsight.spend).label("spend"),
            func.sum(FBInsight.impressions).label("impressions"),
            func.sum(FBInsight.clicks).label("clicks"),
            func.sum(FBInsight.results).label("results"),
            func.sum(FBInsight.purchase_value).label("purchase_value"),
        ).where(
            FBInsight.tenant_id == user.tenant_id,
            FBInsight.object_type == "campaign",
            FBInsight.date >= df,
            FBInsight.date <= dt,
        )
    )
    row = result.one()
    spend = row.spend or 0
    impressions = row.impressions or 0
    clicks = row.clicks or 0
    results = row.results or 0
    pv = row.purchase_value or 0

    return InsightSummary(
        total_spend=spend,
        total_impressions=impressions,
        total_clicks=clicks,
        avg_ctr=round((clicks / impressions * 100) if impressions > 0 else 0, 2),
        total_results=results,
        avg_cost_per_result=(spend // results) if results > 0 else 0,
        total_purchase_value=pv,
        avg_roas=round(pv / spend, 2) if spend > 0 else 0,
    )


@router.post("/sync")
async def trigger_sync(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a manual FB data sync — always runs inline for immediate results."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")
    if not account:
        raise HTTPException(status_code=400, detail="No ad account selected.")

    meta = MetaAPIService()
    try:
        token = meta.decrypt_token(conn.access_token_encrypted)
    except Exception as e:
        logger.error("Token decryption failed for tenant %s: %s", user.tenant_id, e)
        raise HTTPException(status_code=400, detail="Facebook token invalid. Please reconnect your account.")

    stats = {"campaigns": 0, "adsets": 0, "ads": 0, "insights": 0}
    logger.info("Starting inline sync for tenant %s, ad account %s", user.tenant_id, account.account_id)

    try:
        # 1. Sync campaigns
        campaigns = await meta.list_campaigns(token, account.account_id)
        logger.info("Fetched %d campaigns from Meta for account %s", len(campaigns), account.account_id)

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
                    tenant_id=user.tenant_id,
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
                        tenant_id=user.tenant_id,
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
                            tenant_id=user.tenant_id,
                            adset_id=adset.id,
                            ad_id=ad_data["ad_id"],
                            name=ad_data["name"],
                            status=ad_data["status"],
                            creative_id=ad_data["creative_id"],
                            creative_data=ad_data["creative_data"],
                            raw_data=ad_data["raw_data"],
                        ))
                    stats["ads"] += 1

        logger.info("Synced structure: %d campaigns, %d adsets, %d ads", stats["campaigns"], stats["adsets"], stats["ads"])

        # 4. Sync insights (last 90 days) — only if we have campaigns
        if stats["campaigns"] > 0:
            date_to = date.today().isoformat()
            date_from = (date.today() - timedelta(days=90)).isoformat()

            for level in ("campaign", "adset", "ad"):
                rows = await meta.get_insights(
                    token, account.account_id, date_from, date_to, level=level
                )
                logger.info("Fetched %d %s-level insight rows", len(rows), level)
                for row in rows:
                    row_date = date.fromisoformat(row["date"]) if isinstance(row["date"], str) else row["date"]
                    existing = await db.execute(
                        select(FBInsight).where(
                            FBInsight.object_type == row["object_type"],
                            FBInsight.object_id == row["object_id"],
                            FBInsight.date == row_date,
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
                            tenant_id=user.tenant_id,
                            object_type=row["object_type"],
                            object_id=row["object_id"],
                            date=row_date,
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

        conn.last_synced_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info("Sync complete for tenant %s: %s", user.tenant_id, stats)

    except httpx.HTTPStatusError as e:
        logger.error("Meta API error during sync for tenant %s: %s — %s", user.tenant_id, e.response.status_code, e.response.text)
        await db.rollback()
        detail = "Meta API error"
        try:
            err_data = e.response.json()
            detail = err_data.get("error", {}).get("message", str(e))
        except Exception:
            detail = str(e)
        raise HTTPException(status_code=502, detail=f"Meta API: {detail}")

    except Exception as e:
        logger.exception("Sync failed for tenant %s", user.tenant_id)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")

    return {"detail": "Sync complete.", "stats": stats}


@router.post("/campaigns/{campaign_db_id}/status")
async def update_campaign_status(
    campaign_db_id: str,
    body: StatusUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a campaign's status (ACTIVE/PAUSED) on Meta."""
    result = await db.execute(
        select(FBCampaign).where(
            FBCampaign.tenant_id == user.tenant_id,
            FBCampaign.id == uuid.UUID(campaign_db_id),
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    conn, _ = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")

    meta = MetaAPIService()
    token = meta.decrypt_token(conn.access_token_encrypted)
    await meta.update_campaign_status(token, campaign.campaign_id, body.status)
    campaign.status = body.status
    await db.commit()
    return {"detail": f"Campaign status updated to {body.status}."}


@router.post("/adsets/{adset_db_id}/status")
async def update_adset_status(
    adset_db_id: str,
    body: StatusUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an ad set's status on Meta."""
    result = await db.execute(
        select(FBAdSet).where(
            FBAdSet.tenant_id == user.tenant_id,
            FBAdSet.id == uuid.UUID(adset_db_id),
        )
    )
    adset = result.scalar_one_or_none()
    if not adset:
        raise HTTPException(status_code=404, detail="Ad set not found.")

    conn, _ = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")

    meta = MetaAPIService()
    token = meta.decrypt_token(conn.access_token_encrypted)
    await meta.update_adset_status(token, adset.adset_id, body.status)
    adset.status = body.status
    await db.commit()
    return {"detail": f"Ad set status updated to {body.status}."}


@router.post("/ads/{ad_db_id}/status")
async def update_ad_status(
    ad_db_id: str,
    body: StatusUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an ad's status on Meta."""
    result = await db.execute(
        select(FBAd).where(
            FBAd.tenant_id == user.tenant_id,
            FBAd.id == uuid.UUID(ad_db_id),
        )
    )
    ad = result.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found.")

    conn, _ = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")

    meta = MetaAPIService()
    token = meta.decrypt_token(conn.access_token_encrypted)
    await meta.update_ad_status(token, ad.ad_id, body.status)
    ad.status = body.status
    await db.commit()
    return {"detail": f"Ad status updated to {body.status}."}


# ---------------------------------------------------------------------------
# Phase 3: AI Insights / Scoring
# ---------------------------------------------------------------------------

@router.get("/insights/scores")
async def list_insight_scores(
    group_type: str = Query("creative"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[InsightScoreResponse]:
    """Get existing AI scores for a group type."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not account:
        return []

    df, dt = _default_date_range(date_from, date_to)

    result = await db.execute(
        select(FBInsightScore).where(
            FBInsightScore.tenant_id == user.tenant_id,
            FBInsightScore.ad_account_id == account.id,
            FBInsightScore.group_type == group_type,
            FBInsightScore.date_range_start == df,
            FBInsightScore.date_range_end == dt,
        ).order_by(FBInsightScore.score.desc())
    )
    scores = result.scalars().all()
    return [
        InsightScoreResponse(
            id=str(s.id),
            group_type=s.group_type,
            group_value=s.group_value,
            score=float(s.score),
            metrics=s.metrics or {},
            date_range_start=str(s.date_range_start),
            date_range_end=str(s.date_range_end),
        )
        for s in scores
    ]


@router.post("/insights/score")
async def run_ai_scoring(
    body: ScoreRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI scoring for ad components. Costs 5 credits."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")
    if not account:
        raise HTTPException(status_code=400, detail="No ad account selected.")

    df, dt = _default_date_range(body.date_from, body.date_to)

    from app.services.fb_insights_ai import score_ad_components
    scores = await score_ad_components(db, user.tenant_id, account.id, df.isoformat(), dt.isoformat(), body.group_type)
    await db.commit()

    return {"detail": f"Scored {len(scores)} {body.group_type} components.", "count": len(scores)}


# ---------------------------------------------------------------------------
# Phase 4: Winning Ads
# ---------------------------------------------------------------------------

@router.get("/winning-ads")
async def list_winning_ads(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WinningAdResponse]:
    """List winning ads ranked by performance score."""
    result = await db.execute(
        select(FBWinningAd, FBAd)
        .join(FBAd, FBWinningAd.ad_id == FBAd.id)
        .where(FBWinningAd.tenant_id == user.tenant_id)
        .order_by(FBWinningAd.rank)
    )
    rows = result.all()

    response = []
    for winning, ad in rows:
        # Get targeting from ad set
        adset_r = await db.execute(select(FBAdSet).where(FBAdSet.id == ad.adset_id))
        adset = adset_r.scalar_one_or_none()
        targeting = adset.targeting if adset else {}

        response.append(WinningAdResponse(
            id=str(winning.id),
            rank=winning.rank,
            score=float(winning.score),
            ad_id=str(ad.id),
            ad_name=ad.name,
            ad_meta_id=ad.ad_id,
            ad_status=ad.status,
            creative_data=ad.creative_data or {},
            targeting=targeting or {},
            total_spend=winning.total_spend,
            total_results=winning.total_results,
            cost_per_result=winning.cost_per_result,
            roas=float(winning.roas),
            ctr=float(winning.ctr),
            detected_at=winning.detected_at.isoformat() if winning.detected_at else "",
        ))

    return response


@router.post("/winning-ads/detect")
async def trigger_winning_detection(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger winning ads detection."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")
    if not account:
        raise HTTPException(status_code=400, detail="No ad account selected.")

    from app.services.fb_insights_ai import detect_winning_ads
    winners = await detect_winning_ads(db, user.tenant_id, account.id)
    await db.commit()

    return {"detail": f"Detected {len(winners)} winning ads.", "count": len(winners)}


# ---------------------------------------------------------------------------
# Custom Audience from Scraped Profiles
# ---------------------------------------------------------------------------

def _norm_gender_for_meta(val: str | None) -> str:
    """Normalize gender to 'm' or 'f' for Meta Custom Audience schema."""
    if not val:
        return ""
    low = val.strip().lower()
    if low in ("male", "m"):
        return "m"
    if low in ("female", "f"):
        return "f"
    return ""


def _format_dob_for_meta(val: str | None) -> str:
    """Convert birthday to YYYYMMDD format for Meta hashing."""
    if not val or val == "NA":
        return ""
    from datetime import datetime as _dt
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return _dt.strptime(val.strip(), fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    return ""


@router.post("/custom-audience")
async def create_custom_audience(
    body: CreateCustomAudienceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a Meta Custom Audience from a scraping job's profiles.

    Maps scraped profiles to Meta identifiers (fn, ln, gen, dob, ct, country),
    SHA-256 hashes all PII, and uploads via Graph API.
    """
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")
    if not account:
        raise HTTPException(status_code=400, detail="No ad account selected.")

    # Verify job ownership
    job_r = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == uuid.UUID(body.job_id),
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    job = job_r.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    # Load scraped profiles
    result = await db.execute(
        select(ScrapedProfile).where(
            ScrapedProfile.job_id == job.id,
            ScrapedProfile.scrape_status == "success",
        )
    )
    profiles = result.scalars().all()
    if len(profiles) < 100:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 100 profiles to create a Custom Audience (found {len(profiles)}).",
        )

    meta = MetaAPIService()
    token = meta.decrypt_token(conn.access_token_encrypted)

    # Build audience name
    audience_name = body.audience_name or f"SocyBase - {job.input_value or str(job.id)[:8]}"
    audience_name = audience_name[:50]  # Meta 50-char limit

    # 1. Create the Custom Audience
    ca_resp = await meta.create_custom_audience(
        token,
        account.account_id,
        name=audience_name,
        description=f"Created from SocyBase job {str(job.id)[:8]} ({len(profiles)} profiles)",
    )
    audience_id = ca_resp.get("id")
    if not audience_id:
        raise HTTPException(status_code=502, detail="Failed to create Custom Audience on Meta.")

    # 2. Build user records from scraped profiles
    users = []
    for p in profiles:
        users.append({
            "fn": p.first_name or "",
            "ln": p.last_name or "",
            "gen": _norm_gender_for_meta(p.gender),
            "dob": _format_dob_for_meta(p.birthday),
            "ct": p.hometown or "",
            "country": p.location or "",
        })

    # 3. Upload users (hashed by MetaAPIService)
    upload_resp = await meta.add_users_to_audience(token, audience_id, users)

    return {
        "audience_id": audience_id,
        "audience_name": audience_name,
        "profiles_uploaded": len(profiles),
        "num_received": upload_resp.get("num_received", len(profiles)),
    }


# ---------------------------------------------------------------------------
# Phase 5: AI Campaign Builder
# ---------------------------------------------------------------------------

GENERATION_CREDIT_COST = 20


def _build_campaign_response(campaign: AICampaign, adsets: list | None = None) -> AICampaignResponse:
    """Build a standard AICampaignResponse from a campaign model."""
    return AICampaignResponse(
        id=str(campaign.id),
        status=campaign.status,
        name=campaign.name,
        objective=campaign.objective,
        daily_budget=campaign.daily_budget,
        landing_page_url=campaign.landing_page_url,
        conversion_event=campaign.conversion_event,
        audience_strategy=campaign.audience_strategy,
        creative_strategy=campaign.creative_strategy,
        custom_instructions=campaign.custom_instructions,
        ai_summary=campaign.ai_summary,
        generation_progress=campaign.generation_progress,
        credits_used=campaign.credits_used,
        meta_campaign_id=campaign.meta_campaign_id,
        published_at=campaign.published_at.isoformat() if campaign.published_at else None,
        created_at=campaign.created_at.isoformat(),
        adsets=adsets or [],
    )


async def _load_campaign_adsets(db: AsyncSession, campaign_id) -> list[AICampaignAdSetResponse]:
    """Load ad sets and ads for a campaign."""
    adsets_r = await db.execute(
        select(AICampaignAdSet).where(AICampaignAdSet.campaign_id == campaign_id)
    )
    adsets = []
    for adset in adsets_r.scalars().all():
        ads_r = await db.execute(
            select(AICampaignAd).where(AICampaignAd.adset_id == adset.id)
        )
        ads = [
            AICampaignAdResponse(
                id=str(ad.id),
                name=ad.name,
                headline=ad.headline,
                primary_text=ad.primary_text,
                description=ad.description,
                creative_source=ad.creative_source,
                cta_type=ad.cta_type,
                destination_url=ad.destination_url,
            )
            for ad in ads_r.scalars().all()
        ]
        adsets.append(AICampaignAdSetResponse(
            id=str(adset.id),
            name=adset.name,
            targeting=adset.targeting or {},
            daily_budget=adset.daily_budget,
            ads=ads,
        ))
    return adsets


async def _check_credits(db: AsyncSession, tenant_id, required: int) -> CreditBalance:
    """Check tenant has enough credits, raise 402 if not."""
    balance_r = await db.execute(
        select(CreditBalance).where(CreditBalance.tenant_id == tenant_id).with_for_update()
    )
    balance = balance_r.scalar_one_or_none()
    if not balance or balance.balance < required:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient credits. Need {required}, have {balance.balance if balance else 0}.",
        )
    return balance


async def _deduct_credits(
    db: AsyncSession, balance: CreditBalance, amount: int,
    user_id, description: str, ref_type: str, ref_id,
):
    """Deduct credits and record a transaction."""
    balance.balance -= amount
    balance.lifetime_used += amount
    db.add(CreditTransaction(
        tenant_id=balance.tenant_id,
        user_id=user_id,
        type="usage",
        amount=-amount,
        balance_after=balance.balance,
        description=description,
        reference_type=ref_type,
        reference_id=ref_id,
    ))


@router.post("/launch")
async def create_ai_campaign(
    body: CreateCampaignRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an AI campaign draft."""
    conn, account = await _get_active_connection(db, user.tenant_id)
    if not conn:
        raise HTTPException(status_code=400, detail="No active Facebook connection.")
    if not account:
        raise HTTPException(status_code=400, detail="No ad account selected.")

    # Validate budget
    if body.daily_budget < 100:  # min $1.00
        raise HTTPException(status_code=400, detail="Daily budget must be at least $1.00 (100 cents).")

    campaign = AICampaign(
        tenant_id=user.tenant_id,
        user_id=user.id,
        ad_account_id=account.id,
        name=body.name,
        objective=body.objective,
        daily_budget=body.daily_budget,
        page_id=uuid.UUID(body.page_id) if body.page_id else None,
        pixel_id=uuid.UUID(body.pixel_id) if body.pixel_id else None,
        conversion_event=body.conversion_event,
        landing_page_url=body.landing_page_url,
        audience_strategy=body.audience_strategy,
        creative_strategy=body.creative_strategy,
        historical_data_range=body.historical_data_range,
        custom_instructions=body.custom_instructions,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    return {"id": str(campaign.id), "status": campaign.status}


@router.get("/launch/history")
async def list_ai_campaigns(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AICampaignResponse]:
    """List previous AI campaigns."""
    result = await db.execute(
        select(AICampaign).where(AICampaign.tenant_id == user.tenant_id).order_by(AICampaign.created_at.desc())
    )
    return [_build_campaign_response(c) for c in result.scalars().all()]


@router.get("/launch/{campaign_id}")
async def get_ai_campaign(
    campaign_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AICampaignResponse:
    """Get AI campaign with all ad sets and ads."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    adsets = await _load_campaign_adsets(db, campaign.id)
    return _build_campaign_response(campaign, adsets)


@router.put("/launch/{campaign_id}")
async def update_ai_campaign(
    campaign_id: str,
    body: UpdateCampaignRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Edit AI campaign draft before publishing."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if campaign.status not in ("ready", "draft"):
        raise HTTPException(status_code=400, detail="Can only edit campaigns in draft or ready state.")

    # Update campaign-level fields
    if body.name is not None:
        campaign.name = body.name
    if body.daily_budget is not None:
        campaign.daily_budget = body.daily_budget
    if body.landing_page_url is not None:
        campaign.landing_page_url = body.landing_page_url
    if body.conversion_event is not None:
        campaign.conversion_event = body.conversion_event
    if body.custom_instructions is not None:
        campaign.custom_instructions = body.custom_instructions

    # Update ad sets and ads if provided
    if body.adsets:
        for adset_data in body.adsets:
            adset_id = adset_data.get("id")
            if not adset_id:
                continue
            adset_r = await db.execute(
                select(AICampaignAdSet).where(AICampaignAdSet.id == uuid.UUID(adset_id))
            )
            adset = adset_r.scalar_one_or_none()
            if not adset:
                continue
            if "name" in adset_data:
                adset.name = adset_data["name"]
            if "daily_budget" in adset_data:
                adset.daily_budget = adset_data["daily_budget"]
            if "targeting" in adset_data:
                adset.targeting = adset_data["targeting"]

            for ad_data in adset_data.get("ads", []):
                ad_id = ad_data.get("id")
                if not ad_id:
                    continue
                ad_r = await db.execute(
                    select(AICampaignAd).where(AICampaignAd.id == uuid.UUID(ad_id))
                )
                ad = ad_r.scalar_one_or_none()
                if not ad:
                    continue
                if "headline" in ad_data:
                    ad.headline = ad_data["headline"]
                if "primary_text" in ad_data:
                    ad.primary_text = ad_data["primary_text"]
                if "description" in ad_data:
                    ad.description = ad_data["description"]
                if "cta_type" in ad_data:
                    ad.cta_type = ad_data["cta_type"]

    await db.commit()
    adsets = await _load_campaign_adsets(db, campaign.id)
    return _build_campaign_response(campaign, adsets)


@router.post("/launch/{campaign_id}/generate")
async def trigger_generation(
    campaign_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI campaign generation (costs 20 credits)."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if campaign.status not in ("draft", "failed", "ready"):
        raise HTTPException(status_code=400, detail=f"Campaign is in '{campaign.status}' state, cannot regenerate.")

    # Check and deduct credits upfront
    balance = await _check_credits(db, user.tenant_id, GENERATION_CREDIT_COST)
    await _deduct_credits(
        db, balance, GENERATION_CREDIT_COST, user.id,
        f"AI campaign generation: {campaign.name}",
        "ai_campaign", campaign.id,
    )
    await db.commit()

    # Try Celery first, fall back to inline generation
    try:
        from app.scraping.fb_sync_tasks import generate_ai_campaign
        task = generate_ai_campaign.delay(str(campaign.id))
        return {"detail": "Generation started.", "task_id": task.id}
    except Exception:
        logger.info("Celery not available, running AI generation inline for campaign %s", campaign_id)

    # Inline generation
    try:
        from app.services.ai_campaign_gen import generate_campaign
        await generate_campaign(db, str(campaign.id))
        await db.refresh(campaign)
        adsets = await _load_campaign_adsets(db, campaign.id)
        return {"detail": "Generation complete.", "campaign": _build_campaign_response(campaign, adsets).model_dump()}
    except Exception as e:
        logger.exception("Inline AI generation failed for campaign %s", campaign_id)
        # Refund credits on failure
        try:
            balance_r = await db.execute(
                select(CreditBalance).where(CreditBalance.tenant_id == user.tenant_id).with_for_update()
            )
            balance = balance_r.scalar_one_or_none()
            if balance:
                balance.balance += GENERATION_CREDIT_COST
                balance.lifetime_used -= GENERATION_CREDIT_COST
                db.add(CreditTransaction(
                    tenant_id=user.tenant_id,
                    user_id=user.id,
                    type="refund",
                    amount=GENERATION_CREDIT_COST,
                    balance_after=balance.balance,
                    description=f"Refund: AI campaign generation failed — {campaign.name}",
                    reference_type="ai_campaign",
                    reference_id=campaign.id,
                ))
                await db.commit()
        except Exception:
            logger.exception("Failed to refund credits for campaign %s", campaign_id)
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}. Credits have been refunded.")


@router.post("/launch/{campaign_id}/publish")
async def publish_campaign(
    campaign_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Publish AI campaign to Meta Ads Manager."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if campaign.status != "ready":
        raise HTTPException(status_code=400, detail=f"Campaign must be in 'ready' state to publish (current: {campaign.status}).")

    # Try Celery first, fall back to inline publish
    try:
        from app.scraping.fb_sync_tasks import publish_ai_campaign
        task = publish_ai_campaign.delay(str(campaign.id))
        return {"detail": "Publishing started.", "task_id": task.id}
    except Exception:
        logger.info("Celery not available, running publish inline for campaign %s", campaign_id)

    # Inline publish
    try:
        from app.scraping.fb_sync_tasks import _run_publish
        import asyncio
        result_data = await _run_publish(str(campaign.id))
        await db.refresh(campaign)
        return {"detail": "Published successfully.", "meta_campaign_id": result_data.get("meta_campaign_id")}
    except Exception as e:
        logger.exception("Inline publish failed for campaign %s", campaign_id)
        # Reset status if stuck in publishing
        await db.refresh(campaign)
        if campaign.status == "publishing":
            campaign.status = "ready"
            await db.commit()
        raise HTTPException(status_code=500, detail=f"Publishing failed: {str(e)}")


@router.delete("/launch/{campaign_id}")
async def delete_ai_campaign(
    campaign_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an AI campaign draft."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if campaign.status in ("generating", "publishing"):
        raise HTTPException(status_code=400, detail="Cannot delete a campaign that is currently processing.")

    await db.delete(campaign)
    await db.commit()
    return {"detail": "Campaign deleted."}


class RegenerateAdRequest(BaseModel):
    custom_instructions: str | None = None


@router.post("/launch/{campaign_id}/ads/{ad_id}/regenerate")
async def regenerate_single_ad(
    campaign_id: str,
    ad_id: str,
    body: RegenerateAdRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Regenerate a single ad's copy using AI (free, no credit cost)."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if campaign.status != "ready":
        raise HTTPException(status_code=400, detail="Campaign must be in 'ready' state.")

    ad_r = await db.execute(select(AICampaignAd).where(AICampaignAd.id == uuid.UUID(ad_id)))
    ad = ad_r.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found.")

    # Get the ad set for targeting context
    adset_r = await db.execute(select(AICampaignAdSet).where(AICampaignAdSet.id == ad.adset_id))
    adset = adset_r.scalar_one_or_none()

    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured.")

    from openai import AsyncOpenAI
    import json

    ai_client = AsyncOpenAI(api_key=settings.openai_api_key)

    targeting_summary = ""
    if adset and adset.targeting:
        t = adset.targeting
        if t.get("age_min"):
            targeting_summary += f"Age {t['age_min']}-{t.get('age_max', 65)}. "
        if t.get("genders"):
            g = t["genders"]
            if isinstance(g, list):
                targeting_summary += "Gender: " + ", ".join("Male" if x == 1 else "Female" for x in g) + ". "

    response = await ai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": (
                "You are an expert Facebook Ads copywriter. "
                "Generate a fresh alternative version of an ad creative. "
                "Keep it compelling and concise."
            )},
            {"role": "user", "content": f"""Generate one alternative Facebook ad creative.

Current ad for reference (create something different):
- Headline: {ad.headline}
- Primary text: {ad.primary_text}
- Description: {ad.description or 'None'}

Campaign objective: {campaign.objective}
Audience: {targeting_summary or 'Broad'}
Landing page: {campaign.landing_page_url or 'Not specified'}
{f'Instructions: {body.custom_instructions}' if body.custom_instructions else ''}

Return a JSON object with: headline (max 40 chars), primary_text (max 125 chars), description (max 30 chars, optional), cta_type (one of LEARN_MORE, SIGN_UP, SHOP_NOW, GET_OFFER, CONTACT_US).
Only return valid JSON, no markdown."""},
        ],
        temperature=0.8,
        max_tokens=400,
    )

    from app.services.ai_campaign_gen import _parse_json_response
    new_copy = _parse_json_response(
        response.choices[0].message.content or "{}",
        {"headline": ad.headline, "primary_text": ad.primary_text, "cta_type": ad.cta_type},
    )

    ad.headline = new_copy.get("headline", ad.headline)
    ad.primary_text = new_copy.get("primary_text", ad.primary_text)
    ad.description = new_copy.get("description", ad.description)
    ad.cta_type = new_copy.get("cta_type", ad.cta_type)
    await db.commit()

    adsets = await _load_campaign_adsets(db, campaign.id)
    return _build_campaign_response(campaign, adsets)


@router.post("/launch/{campaign_id}/duplicate")
async def duplicate_ai_campaign(
    campaign_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Duplicate an existing AI campaign as a new draft."""
    result = await db.execute(
        select(AICampaign).where(
            AICampaign.id == uuid.UUID(campaign_id),
            AICampaign.tenant_id == user.tenant_id,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Campaign not found.")

    new_campaign = AICampaign(
        tenant_id=user.tenant_id,
        user_id=user.id,
        ad_account_id=source.ad_account_id,
        name=f"{source.name} (Copy)",
        objective=source.objective,
        daily_budget=source.daily_budget,
        page_id=source.page_id,
        pixel_id=source.pixel_id,
        conversion_event=source.conversion_event,
        landing_page_url=source.landing_page_url,
        audience_strategy=source.audience_strategy,
        creative_strategy=source.creative_strategy,
        historical_data_range=source.historical_data_range,
        custom_instructions=source.custom_instructions,
    )
    db.add(new_campaign)
    await db.flush()

    # Copy ad sets and ads
    adsets_r = await db.execute(
        select(AICampaignAdSet).where(AICampaignAdSet.campaign_id == source.id)
    )
    for src_adset in adsets_r.scalars().all():
        new_adset = AICampaignAdSet(
            campaign_id=new_campaign.id,
            name=src_adset.name,
            targeting=src_adset.targeting,
            daily_budget=src_adset.daily_budget,
        )
        db.add(new_adset)
        await db.flush()

        ads_r = await db.execute(
            select(AICampaignAd).where(AICampaignAd.adset_id == src_adset.id)
        )
        for src_ad in ads_r.scalars().all():
            db.add(AICampaignAd(
                adset_id=new_adset.id,
                name=src_ad.name,
                headline=src_ad.headline,
                primary_text=src_ad.primary_text,
                description=src_ad.description,
                creative_source=src_ad.creative_source,
                cta_type=src_ad.cta_type,
                destination_url=src_ad.destination_url,
            ))

    await db.commit()
    await db.refresh(new_campaign)
    adsets = await _load_campaign_adsets(db, new_campaign.id)
    return _build_campaign_response(new_campaign, adsets)
