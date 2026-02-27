"""Meta Marketing API client — OAuth, token management, account listing."""

import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet

from app.config import get_settings

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = "v22.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

# Facebook pagination URLs may return a different API version (e.g. v25.0)
# which can cause 403 errors if the app isn't approved for that version.
_VERSION_RE = re.compile(r"graph\.facebook\.com/v[\d.]+/")


def _pin_api_version(url: str | None) -> str | None:
    """Rewrite a Facebook pagination URL to use our pinned API version."""
    if not url:
        return None
    return _VERSION_RE.sub(f"graph.facebook.com/{GRAPH_API_VERSION}/", url)

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
        async with httpx.AsyncClient() as client:
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
        async with httpx.AsyncClient() as client:
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
        async with httpx.AsyncClient() as client:
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
        async with httpx.AsyncClient() as client:
            while url:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
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
                url = _pin_api_version(data.get("paging", {}).get("next"))
                params = {}  # next URL includes params
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
        async with httpx.AsyncClient() as client:
            while url:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
                for pg in data.get("data", []):
                    pages.append({
                        "page_id": pg.get("id", ""),
                        "name": pg.get("name", "Unknown"),
                        "category": pg.get("category"),
                        "picture_url": pg.get("picture", {}).get("data", {}).get("url"),
                        "access_token": pg.get("access_token"),
                    })
                url = _pin_api_version(data.get("paging", {}).get("next"))
                params = {}
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

    async def list_campaigns(self, access_token: str, ad_account_id: str) -> list[dict]:
        """Fetch all campaigns for an ad account."""
        campaigns = []
        url = f"{GRAPH_BASE}/{ad_account_id}/campaigns"
        params = {
            **self._auth_params(access_token),
            "fields": "id,name,objective,status,daily_budget,lifetime_budget,buying_type,created_time,updated_time",
            "limit": 200,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            while url:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
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
                url = _pin_api_version(data.get("paging", {}).get("next"))
                params = {}
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
                resp = await client.get(url, params=params)
                resp.raise_for_status()
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
                url = _pin_api_version(data.get("paging", {}).get("next"))
                params = {}
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
                resp = await client.get(url, params=params)
                resp.raise_for_status()
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
                url = _pin_api_version(data.get("paging", {}).get("next"))
                params = {}
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
                resp = await client.get(url, params=params)
                resp.raise_for_status()
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
                url = _pin_api_version(data.get("paging", {}).get("next"))
                params = {}
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
        """Create a Custom Audience (customer_list subtype) and return its ID."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{GRAPH_BASE}/{ad_account_id}/customaudiences",
                params=self._auth_params(access_token),
                data={
                    "name": name,
                    "subtype": "CUSTOM",
                    "description": description,
                    "customer_file_source": "USER_PROVIDED_ONLY",
                },
            )
            resp.raise_for_status()
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
        for i in range(0, len(data_rows), 10000):
            chunk = data_rows[i : i + 10000]
            payload = json.dumps({
                "schema": schema,
                "data": chunk,
            })
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{GRAPH_BASE}/{audience_id}/users",
                    params=self._auth_params(access_token),
                    data={"payload": payload},
                )
                resp.raise_for_status()
                results.append(resp.json())

        return results[-1] if results else {}
