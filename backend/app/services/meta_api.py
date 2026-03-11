"""Meta Marketing API client — OAuth, token management, account listing."""

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet

from app.config import get_settings

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = "v22.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

REQUIRED_SCOPES = [
    "ads_management",
    "ads_read",
    "business_management",
    "pages_read_engagement",
    "pages_show_list",
]


class MetaAPIService:
    """Wraps the Meta Graph API for OAuth and account management."""

    def __init__(self):
        settings = get_settings()
        self.app_id = settings.meta_app_id
        self.app_secret = settings.meta_app_secret
        self.redirect_uri = settings.effective_meta_redirect_uri
        self._fernet = Fernet(settings.token_encryption_key.encode()) if settings.token_encryption_key else None

    # -- Token encryption helpers ------------------------------------------

    def encrypt_token(self, token: str) -> str:
        if not self._fernet:
            raise RuntimeError("TOKEN_ENCRYPTION_KEY not configured")
        return self._fernet.encrypt(token.encode()).decode()

    def decrypt_token(self, encrypted: str) -> str:
        if not self._fernet:
            raise RuntimeError("TOKEN_ENCRYPTION_KEY not configured")
        return self._fernet.decrypt(encrypted.encode()).decode()

    def _auth_params(self, access_token: str) -> dict:
        """Return auth query params for Graph API calls."""
        return {"access_token": access_token}

    async def _get_with_retry(
        self, client: httpx.AsyncClient, url: str, params: dict,
        max_retries: int = 3,
    ) -> httpx.Response:
        """GET with automatic retry on Facebook rate limit (error code 17)."""
        for attempt in range(max_retries + 1):
            resp = await client.get(url, params=params)
            if resp.status_code == 400:
                try:
                    body = resp.json()
                    if body.get("error", {}).get("code") == 17:
                        if attempt < max_retries:
                            wait = min(2 ** (attempt + 1), 60)
                            logger.warning(
                                "Rate limit hit, retrying in %ds (attempt %d/%d)",
                                wait, attempt + 1, max_retries,
                            )
                            await asyncio.sleep(wait)
                            continue
                except Exception:
                    pass
            resp.raise_for_status()
            return resp
        # Should not reach here, but just in case
        resp.raise_for_status()
        return resp

    # -- OAuth flow --------------------------------------------------------

    def get_oauth_url(self, state: str = "") -> str:
        """Return the Facebook OAuth dialog URL."""
        params = {
            "client_id": self.app_id,
            "redirect_uri": self.redirect_uri,
            "scope": ",".join(REQUIRED_SCOPES),
            "response_type": "code",
            "state": state,
        }
        return f"https://www.facebook.com/{GRAPH_API_VERSION}/dialog/oauth?{urlencode(params)}"

    async def exchange_code(self, code: str) -> dict:
        """Exchange authorization code for a short-lived access token."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/oauth/access_token",
                params={
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "redirect_uri": self.redirect_uri,
                    "code": code,
                },
            )
            resp.raise_for_status()
            return resp.json()  # {access_token, token_type, expires_in}

    async def get_long_lived_token(self, short_token: str) -> dict:
        """Exchange a short-lived token for a long-lived one (~60 days)."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": self.app_id,
                    "client_secret": self.app_secret,
                    "fb_exchange_token": short_token,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            # Calculate absolute expiry
            expires_in = data.get("expires_in", 5184000)  # default 60 days
            data["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            return data

    # -- User info ---------------------------------------------------------

    async def get_user_info(self, access_token: str) -> dict:
        """Fetch basic info about the authenticated Facebook user."""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/me",
                params={**self._auth_params(access_token), "fields": "id,name"},
            )
            resp.raise_for_status()
            return resp.json()

    # -- Ad accounts -------------------------------------------------------

    async def list_ad_accounts(self, access_token: str) -> list[dict]:
        """List all ad accounts the user has access to."""
        accounts = []
        url = f"{GRAPH_BASE}/me/adaccounts"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name,account_id,currency,timezone_name,account_status",
            "limit": 100,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await self._get_with_retry(client, url, params)
                data = resp.json()
                for acc in data.get("data", []):
                    status_map = {1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 9: "IN_GRACE_PERIOD", 101: "PENDING_CLOSURE"}
                    accounts.append({
                        "account_id": acc.get("id", ""),  # act_xxx
                        "name": acc.get("name", "Unknown"),
                        "currency": acc.get("currency", "USD"),
                        "timezone_name": acc.get("timezone_name", "UTC"),
                        "status": status_map.get(acc.get("account_status"), "UNKNOWN"),
                    })
                # Cursor-based pagination — never follow Facebook's "next" URL
                after = data.get("paging", {}).get("cursors", {}).get("after")
                if after and "next" in data.get("paging", {}):
                    params["after"] = after
                else:
                    url = None
        return accounts

    # -- Pages -------------------------------------------------------------

    async def list_pages(self, access_token: str) -> list[dict]:
        """List Facebook pages the user manages."""
        pages = []
        url = f"{GRAPH_BASE}/me/accounts"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name,category,picture{url},access_token",
            "limit": 100,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await self._get_with_retry(client, url, params)
                data = resp.json()
                for pg in data.get("data", []):
                    pages.append({
                        "page_id": pg.get("id", ""),
                        "name": pg.get("name", "Unknown"),
                        "category": pg.get("category"),
                        "picture_url": pg.get("picture", {}).get("data", {}).get("url"),
                        "access_token": pg.get("access_token"),
                    })
                after = data.get("paging", {}).get("cursors", {}).get("after")
                if after and "next" in data.get("paging", {}):
                    params["after"] = after
                else:
                    url = None
        return pages

    # -- Pixels ------------------------------------------------------------

    async def list_pixels(self, access_token: str, ad_account_id: str) -> list[dict]:
        """List Meta pixels for an ad account."""
        pixels = []
        url = f"{GRAPH_BASE}/{ad_account_id}/adspixels"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name",
            "limit": 100,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            for px in data.get("data", []):
                pixels.append({
                    "pixel_id": px.get("id", ""),
                    "name": px.get("name", "Unknown"),
                })
        return pixels

    # -- Campaigns, Ad Sets, Ads (Phase 2) ---------------------------------

    async def list_campaigns(
        self, access_token: str, ad_account_id: str,
        status_filter: list[str] | None = None,
    ) -> list[dict]:
        """Fetch campaigns for an ad account.

        Args:
            status_filter: List of effective_status values to include.
                           Defaults to ACTIVE + PAUSED to avoid fetching
                           hundreds of deleted/archived campaigns.
        """
        if status_filter is None:
            status_filter = ["ACTIVE", "PAUSED"]
        campaigns = []
        url = f"{GRAPH_BASE}/{ad_account_id}/campaigns"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name,objective,status,daily_budget,lifetime_budget,buying_type,created_time,updated_time",
            "limit": 200,
            "effective_status": json.dumps(status_filter),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await self._get_with_retry(client, url, params)
                data = resp.json()
                for c in data.get("data", []):
                    campaigns.append({
                        "campaign_id": c["id"],
                        "name": c.get("name", ""),
                        "objective": c.get("objective"),
                        "status": c.get("status", "UNKNOWN"),
                        "daily_budget": int(c["daily_budget"]) if c.get("daily_budget") else None,
                        "lifetime_budget": int(c["lifetime_budget"]) if c.get("lifetime_budget") else None,
                        "buying_type": c.get("buying_type"),
                        "created_time": c.get("created_time"),
                        "updated_time": c.get("updated_time"),
                        "raw_data": c,
                    })
                after = data.get("paging", {}).get("cursors", {}).get("after")
                if after and "next" in data.get("paging", {}):
                    params["after"] = after
                else:
                    url = None
        return campaigns

    async def list_adsets(self, access_token: str, campaign_id: str) -> list[dict]:
        """Fetch all ad sets for a campaign."""
        adsets = []
        url = f"{GRAPH_BASE}/{campaign_id}/adsets"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name,status,daily_budget,targeting,optimization_goal,billing_event,bid_strategy,start_time,end_time",
            "limit": 200,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await self._get_with_retry(client, url, params)
                data = resp.json()
                for a in data.get("data", []):
                    adsets.append({
                        "adset_id": a["id"],
                        "name": a.get("name", ""),
                        "status": a.get("status", "UNKNOWN"),
                        "daily_budget": int(a["daily_budget"]) if a.get("daily_budget") else None,
                        "targeting": a.get("targeting", {}),
                        "optimization_goal": a.get("optimization_goal"),
                        "billing_event": a.get("billing_event"),
                        "bid_strategy": a.get("bid_strategy"),
                        "start_time": a.get("start_time"),
                        "end_time": a.get("end_time"),
                        "raw_data": a,
                    })
                after = data.get("paging", {}).get("cursors", {}).get("after")
                if after and "next" in data.get("paging", {}):
                    params["after"] = after
                else:
                    url = None
        return adsets

    async def list_ads(self, access_token: str, adset_id: str) -> list[dict]:
        """Fetch all ads for an ad set."""
        ads = []
        url = f"{GRAPH_BASE}/{adset_id}/ads"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name,status,creative{id,title,body,image_url,video_id,call_to_action_type,object_story_spec,effective_object_story_id,thumbnail_url,link_url}",
            "limit": 200,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await self._get_with_retry(client, url, params)
                data = resp.json()
                for ad in data.get("data", []):
                    creative = ad.get("creative", {})
                    ads.append({
                        "ad_id": ad["id"],
                        "name": ad.get("name", ""),
                        "status": ad.get("status", "UNKNOWN"),
                        "creative_id": creative.get("id"),
                        "creative_data": creative,
                        "raw_data": ad,
                    })
                after = data.get("paging", {}).get("cursors", {}).get("after")
                if after and "next" in data.get("paging", {}):
                    params["after"] = after
                else:
                    url = None
        return ads

    async def get_insights(
        self, access_token: str, ad_account_id: str,
        date_from: str, date_to: str, level: str = "campaign",
    ) -> list[dict]:
        """Fetch daily insights for campaigns/adsets/ads in date range.

        Args:
            level: 'campaign', 'adset', or 'ad'
            date_from/date_to: 'YYYY-MM-DD'
        """
        insights = []
        url = f"{GRAPH_BASE}/{ad_account_id}/insights"
        params = {
            **self._auth_params(access_token),
            "level": level,
            "time_range": f'{{"since":"{date_from}","until":"{date_to}"}}',
            "time_increment": 1,  # daily breakdown
            "fields": "campaign_id,adset_id,ad_id,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,date_start",
            "limit": 500,
        }
        async with httpx.AsyncClient(timeout=60) as client:
            while url:
                resp = await self._get_with_retry(client, url, params)
                data = resp.json()
                for row in data.get("data", []):
                    # Determine object_id based on level
                    if level == "ad":
                        object_id = row.get("ad_id", "")
                    elif level == "adset":
                        object_id = row.get("adset_id", "")
                    else:
                        object_id = row.get("campaign_id", "")

                    # Parse actions
                    actions = row.get("actions", [])
                    action_values = row.get("action_values", [])
                    results = 0
                    purchase_value = 0
                    for act in actions:
                        if act.get("action_type") in ("lead", "offsite_conversion.fb_pixel_lead", "purchase", "offsite_conversion.fb_pixel_purchase"):
                            results += int(act.get("value", 0))
                    for av in action_values:
                        if av.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"):
                            purchase_value += int(float(av.get("value", 0)) * 100)  # to cents

                    spend_cents = int(float(row.get("spend", 0)) * 100)
                    cpc_cents = int(float(row.get("cpc", 0)) * 100) if row.get("cpc") else 0
                    cpm_cents = int(float(row.get("cpm", 0)) * 100) if row.get("cpm") else 0
                    cost_per_result = (spend_cents // results) if results > 0 else 0
                    roas = round(purchase_value / spend_cents, 4) if spend_cents > 0 else 0

                    insights.append({
                        "object_type": level,
                        "object_id": object_id,
                        "date": row.get("date_start", ""),
                        "spend": spend_cents,
                        "impressions": int(row.get("impressions", 0)),
                        "clicks": int(row.get("clicks", 0)),
                        "ctr": float(row.get("ctr", 0)),
                        "cpc": cpc_cents,
                        "cpm": cpm_cents,
                        "results": results,
                        "cost_per_result": cost_per_result,
                        "purchase_value": purchase_value,
                        "roas": roas,
                        "actions": actions,
                    })
                after = data.get("paging", {}).get("cursors", {}).get("after")
                if after and "next" in data.get("paging", {}):
                    params["after"] = after
                else:
                    url = None
        return insights

    # -- Campaign status management ----------------------------------------

    async def update_campaign_status(self, access_token: str, campaign_id: str, status: str) -> dict:
        """Update campaign status (ACTIVE, PAUSED, etc.)."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{GRAPH_BASE}/{campaign_id}",
                params=self._auth_params(access_token),
                data={"status": status},
            )
            resp.raise_for_status()
            return resp.json()

    async def update_adset_status(self, access_token: str, adset_id: str, status: str) -> dict:
        """Update ad set status."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{GRAPH_BASE}/{adset_id}",
                params=self._auth_params(access_token),
                data={"status": status},
            )
            resp.raise_for_status()
            return resp.json()

    async def update_ad_status(self, access_token: str, ad_id: str, status: str) -> dict:
        """Update ad status."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{GRAPH_BASE}/{ad_id}",
                params=self._auth_params(access_token),
                data={"status": status},
            )
            resp.raise_for_status()
            return resp.json()

    # -- Custom Audiences ----------------------------------------------------

    @staticmethod
    def _sha256(value: str) -> str:
        """SHA-256 hash a value (lowercase, stripped) for Meta Custom Audience."""
        return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()

    async def create_custom_audience(
        self, access_token: str, ad_account_id: str, name: str, description: str = "",
    ) -> dict:
        """Create a Custom Audience (customer_list subtype) and return its ID.

        Automatically labels audience as "High value" in the name and sets value-based flag.
        """
        # Add "High value" label to the audience name
        labeled_name = f"[High Value] {name}"[:50]  # Meta 50-char limit

        async with httpx.AsyncClient(timeout=30) as client:
            # Create the audience
            resp = await client.post(
                f"{GRAPH_BASE}/{ad_account_id}/customaudiences",
                params=self._auth_params(access_token),
                data={
                    "name": labeled_name,
                    "subtype": "CUSTOM",  # CUSTOM subtype for customer list audiences
                    "description": f"High value audience - {description}" if description else "High value audience",
                    "customer_file_source": "USER_PROVIDED_ONLY",
                },
            )
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                # Extract Meta's error details from response
                error_detail = e.response.text
                try:
                    error_json = e.response.json()
                    if "error" in error_json:
                        error_detail = error_json["error"].get("message", error_detail)
                except Exception:
                    pass
                raise Exception(f"Meta API error: {error_detail}") from e
            return resp.json()  # {"id": "audience_id"}

    async def add_users_to_audience(
        self,
        access_token: str,
        audience_id: str,
        users: list[dict],
    ) -> dict:
        """Add hashed user records to a Custom Audience.

        Each user dict can contain: fn, ln, gen, dob, ct, country, phone.
        All PII values are SHA-256 hashed before sending to Meta.

        Args:
            users: list of dicts with keys matching Meta schema fields.
        """
        schema = ["FN", "LN", "GEN", "DOB", "CT", "COUNTRY"]
        data_rows = []
        for u in users:
            row = [
                self._sha256(u.get("fn", "")),
                self._sha256(u.get("ln", "")),
                self._sha256(u.get("gen", "")),
                self._sha256(u.get("dob", "")),
                self._sha256(u.get("ct", "")),
                self._sha256(u.get("country", "")),
            ]
            data_rows.append(row)

        # Meta accepts up to 10,000 per request; chunk if needed
        results = []
        async with httpx.AsyncClient(timeout=60) as client:
            for i in range(0, len(data_rows), 10000):
                chunk = data_rows[i : i + 10000]
                payload = json.dumps({
                    "schema": schema,
                    "data": chunk,
                })
                resp = await client.post(
                    f"{GRAPH_BASE}/{audience_id}/users",
                    params=self._auth_params(access_token),
                    data={"payload": payload},
                )
                resp.raise_for_status()
                results.append(resp.json())

        return results[-1] if results else {}

    async def create_lookalike_audience(
        self,
        access_token: str,
        ad_account_id: str,
        source_audience_id: str,
        name: str,
        country: str = "MY",
        ratio: float = 0.01,
    ) -> dict:
        """Create a Lookalike Audience from a Custom Audience.

        Args:
            access_token: Meta access token
            ad_account_id: Ad account ID (e.g., "act_123456")
            source_audience_id: ID of the source custom audience
            name: Name for the lookalike audience
            country: Two-letter country code (default: MY for Malaysia)
            ratio: Lookalike ratio, 0.01 = 1% (default: 0.01)

        Returns:
            dict with lookalike audience ID
        """
        logger.debug("Creating LLA: origin_audience_id=%s, country=%s, ratio=%s", source_audience_id, country, ratio)

        async with httpx.AsyncClient(timeout=30) as client:
            payload = {
                "name": name,
                "subtype": "LOOKALIKE",
                "origin_audience_id": source_audience_id,
                "lookalike_spec": json.dumps({
                    "country": country,
                    "ratio": ratio,
                }),
            }
            resp = await client.post(
                f"{GRAPH_BASE}/{ad_account_id}/customaudiences",
                params=self._auth_params(access_token),
                data=payload,
            )
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                # Extract Meta's error details from response
                error_detail = e.response.text
                try:
                    error_json = e.response.json()
                    if "error" in error_json:
                        error_detail = error_json["error"].get("message", error_detail)
                except Exception:
                    pass
                raise Exception(f"Meta API error: {error_detail}") from e
            return resp.json()  # {"id": "lookalike_audience_id"}

    async def get_page_posts(
        self, access_token: str, page_id: str, limit: int = 50
    ) -> list[dict]:
        """Fetch posts from a Facebook Page (including livestreams, videos, photos).

        Args:
            access_token: Meta access token
            page_id: Facebook Page ID
            limit: Maximum number of posts to fetch (default: 50)

        Returns:
            List of post dicts with id, message, created_time, type, etc.
        """
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/{page_id}/posts",
                params={
                    **self._auth_params(access_token),
                    "fields": "id,message,created_time,full_picture,permalink_url",
                    "limit": limit,
                },
            )
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                # Extract Meta's error details from response
                error_detail = e.response.text
                try:
                    error_json = e.response.json()
                    if "error" in error_json:
                        error_detail = error_json["error"].get("message", error_detail)
                except Exception:
                    pass
                raise Exception(f"Meta API error: {error_detail}") from e
            data = resp.json()
            return data.get("data", [])

    async def search_interests(
        self, access_token: str, query: str, limit: int = 25
    ) -> list[dict]:
        """Search for valid Meta interest targeting options.

        Calls the Meta Marketing API ``targetingsearch`` endpoint to return
        real interest IDs that can be used in ``flexible_spec``.

        Returns:
            List of dicts with ``id`` (str) and ``name`` (str).
        """
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/search",
                params={
                    **self._auth_params(access_token),
                    "type": "adinterest",
                    "q": query,
                    "limit": limit,
                },
            )
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError:
                logger.warning("Interest search failed for query=%s: %s", query, resp.text)
                return []
            data = resp.json().get("data", [])
            return [{"id": str(item["id"]), "name": item["name"]} for item in data if item.get("id")]

    async def list_custom_audiences(
        self, access_token: str, ad_account_id: str, limit: int = 100
    ) -> list[dict]:
        """List custom audiences for an ad account.

        Args:
            access_token: Meta access token
            ad_account_id: Ad account ID (e.g., "act_123456")
            limit: Maximum number of audiences to fetch (default: 100)

        Returns:
            List of audience dicts with id, name, subtype, etc.
        """
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{GRAPH_BASE}/{ad_account_id}/customaudiences",
                params={
                    **self._auth_params(access_token),
                    "fields": "id,name,subtype,description",
                    "limit": limit,
                },
            )
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError:
                logger.warning(
                    "list_custom_audiences failed: status=%s body=%s",
                    resp.status_code, resp.text[:500],
                )
                return []
            data = resp.json()
            return data.get("data", [])

    @staticmethod
    def _map_boost_goal_to_optimization(boost_goal: str | None) -> str:
        """Map boost goal to Meta API optimization_goal parameter.

        Args:
            boost_goal: One of GET_MORE_MESSAGES, GET_MORE_VIDEO_VIEWS, GET_MORE_LEADS,
                       GET_MORE_CALLS, GET_MORE_WEBSITE_VISITORS

        Returns:
            Meta API optimization_goal value
        """
        goal_mapping = {
            "GET_MORE_MESSAGES": "CONVERSATIONS",
            "GET_MORE_VIDEO_VIEWS": "THRUPLAY",
            "GET_MORE_ENGAGEMENT": "POST_ENGAGEMENT",
            "GET_MORE_LEADS": "LEAD_GENERATION",
            "GET_MORE_CALLS": "CONVERSATIONS",
            "GET_MORE_WEBSITE_VISITORS": "LINK_CLICKS",
            "GET_MORE_LINK_CLICKS": "LINK_CLICKS",
        }
        return goal_mapping.get(boost_goal, "POST_ENGAGEMENT")

    @staticmethod
    def _build_targeting_from_type(
        audience_type: str | None,
        custom_audience_id: str | None = None,
        page_id: str | None = None,
    ) -> dict:
        """Build Meta API targeting spec based on audience type.

        Args:
            audience_type: One of ADVANTAGE_PLUS, TARGETING, PAGE_FANS, PAGE_FANS_SIMILAR,
                          LOCAL_AREA, CUSTOM_AUDIENCE
            custom_audience_id: Required when audience_type is CUSTOM_AUDIENCE
            page_id: Page ID for PAGE_FANS targeting

        Returns:
            Targeting specification dict for Meta API
        """
        targeting: dict = {
            "geo_locations": {"countries": ["MY"]},  # Default to Malaysia
        }

        if audience_type == "ADVANTAGE_PLUS":
            # Advantage+ uses broad targeting — keep targeting minimal
            # targeting_optimization is set at adset level, not inside targeting spec
            pass
        elif audience_type == "CUSTOM_AUDIENCE" and custom_audience_id:
            targeting["custom_audiences"] = [{"id": custom_audience_id}]
        elif audience_type == "PAGE_FANS" and page_id:
            # connections spec only needs {"id": page_id} — no "type" field
            targeting["connections"] = [{"id": page_id}]
        elif audience_type == "PAGE_FANS_SIMILAR" and page_id:
            # friends_of_connections targets friends of page fans
            targeting["friends_of_connections"] = [{"id": page_id}]
        elif audience_type == "LOCAL_AREA":
            # Use location_types for local area targeting
            targeting["geo_locations"]["location_types"] = ["home", "recent"]
        # For TARGETING, return basic targeting (will be enhanced by AI)

        return targeting

    async def create_promoted_post(
        self,
        access_token: str,
        ad_account_id: str,
        post_id: str,
        daily_budget: int | None = None,
        lifetime_budget: int | None = None,
        targeting: dict = None,
        start_time: str | None = None,
        end_time: str | None = None,
        boost_goal: str | None = None,
        audience_type: str | None = None,
        custom_audience_id: str | None = None,
        page_id: str | None = None,
    ) -> dict:
        """Create a promoted/boosted post via the Marketing API.

        Uses the standard campaign → ad set → ad flow with ``object_story_id``
        referencing the existing post.

        Returns:
            dict with ``id`` (the Meta campaign ID) and ``ad_id``.
        """
        from datetime import datetime as _dt

        # Convert ISO datetime to Unix timestamp if provided
        start_timestamp = None
        end_timestamp = None
        if start_time:
            dt = _dt.fromisoformat(start_time.replace("Z", "+00:00"))
            start_timestamp = int(dt.timestamp())
        if end_time:
            dt = _dt.fromisoformat(end_time.replace("Z", "+00:00"))
            end_timestamp = int(dt.timestamp())

        # Build targeting from audience_type
        if audience_type:
            targeting = self._build_targeting_from_type(audience_type, custom_audience_id, page_id)
        if not targeting:
            targeting = {"geo_locations": {"countries": ["MY"]}}

        # Map boost goal → campaign objective + ad set optimization_goal
        objective_map = {
            "GET_MORE_MESSAGES": "OUTCOME_ENGAGEMENT",
            "GET_MORE_VIDEO_VIEWS": "OUTCOME_AWARENESS",
            "GET_MORE_ENGAGEMENT": "OUTCOME_ENGAGEMENT",
            "GET_MORE_LEADS": "OUTCOME_LEADS",
            "GET_MORE_CALLS": "OUTCOME_ENGAGEMENT",
            "GET_MORE_WEBSITE_VISITORS": "OUTCOME_TRAFFIC",
            "GET_MORE_LINK_CLICKS": "OUTCOME_TRAFFIC",
        }
        optimization_goal = self._map_boost_goal_to_optimization(boost_goal)
        campaign_objective = objective_map.get(boost_goal or "", "OUTCOME_ENGAGEMENT")

        # Ensure ad_account_id has act_ prefix
        act_id = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
        auth = self._auth_params(access_token)

        async with httpx.AsyncClient(timeout=30) as client:
            # Helper to raise with full Meta error details
            def _raise_meta(resp: httpx.Response, step: str):
                if resp.status_code >= 400:
                    body = {}
                    try:
                        body = resp.json()
                    except Exception:
                        pass
                    meta_err = body.get("error", {})
                    detail = meta_err.get("error_user_msg") or meta_err.get("message") or resp.text
                    logger.error(
                        "create_promoted_post %s failed: status=%s body=%s",
                        step, resp.status_code, json.dumps(body)[:1000],
                    )
                    raise Exception(f"Meta API error at {step}: {detail}")

            # 1. Create campaign — ODAX objectives do NOT accept promoted_object
            #    at campaign level; it goes on the ad set instead.
            campaign_data: dict = {
                "name": f"Boost — {post_id[:30]}",
                "objective": campaign_objective,
                "status": "PAUSED",
                "special_ad_categories": json.dumps([]),
                "buying_type": "AUCTION",
                "is_adset_budget_sharing_enabled": "false",
            }

            resp = await client.post(
                f"{GRAPH_BASE}/{act_id}/campaigns",
                params=auth,
                data=campaign_data,
            )
            _raise_meta(resp, "campaign_create")
            meta_campaign_id = resp.json()["id"]

            # 2. Create ad set
            adset_data: dict = {
                "name": f"Boost adset — {post_id[:30]}",
                "campaign_id": meta_campaign_id,
                "billing_event": "IMPRESSIONS",
                "optimization_goal": optimization_goal,
                "status": "PAUSED",
                "targeting": json.dumps(targeting),
            }
            # Advantage+ audience: set targeting_optimization at adset level
            if audience_type == "ADVANTAGE_PLUS":
                adset_data["targeting_optimization"] = "expansion_all"
            # promoted_object at ad set level — required for page-based campaigns
            if page_id:
                adset_data["promoted_object"] = json.dumps({"page_id": page_id})
            if lifetime_budget:
                adset_data["lifetime_budget"] = str(lifetime_budget)
            elif daily_budget:
                adset_data["daily_budget"] = str(daily_budget)
            if start_timestamp:
                adset_data["start_time"] = str(start_timestamp)
            if end_timestamp:
                adset_data["end_time"] = str(end_timestamp)

            resp = await client.post(
                f"{GRAPH_BASE}/{act_id}/adsets",
                params=auth,
                data=adset_data,
            )
            _raise_meta(resp, "adset_create")
            meta_adset_id = resp.json()["id"]

            # 3. Create ad creative referencing the existing post
            resp = await client.post(
                f"{GRAPH_BASE}/{act_id}/adcreatives",
                params=auth,
                data={"object_story_id": post_id},
            )
            _raise_meta(resp, "creative_create")
            creative_id = resp.json()["id"]

            # 4. Create ad
            resp = await client.post(
                f"{GRAPH_BASE}/{act_id}/ads",
                params=auth,
                data={
                    "name": f"Boost ad — {post_id[:30]}",
                    "adset_id": meta_adset_id,
                    "creative": json.dumps({"creative_id": creative_id}),
                    "status": "PAUSED",
                },
            )
            _raise_meta(resp, "ad_create")
            ad_id = resp.json()["id"]

            return {"id": meta_campaign_id, "ad_id": ad_id}
