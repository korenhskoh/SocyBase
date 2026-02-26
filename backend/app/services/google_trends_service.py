"""Google Trends integration using pytrends (free, no API key)."""

import asyncio
import json
import logging
from datetime import datetime, timezone

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)

COUNTRY_CODES = {
    "malaysia": "MY", "thailand": "TH", "indonesia": "ID",
    "singapore": "SG", "philippines": "PH", "vietnam": "VN",
    "united states": "US", "united kingdom": "GB", "australia": "AU",
    "india": "IN", "japan": "JP", "south korea": "KR",
    "china": "CN", "taiwan": "TW", "hong kong": "HK",
    "germany": "DE", "france": "FR", "spain": "ES",
    "italy": "IT", "brazil": "BR", "mexico": "MX",
    "canada": "CA", "netherlands": "NL", "sweden": "SE",
    "norway": "NO", "denmark": "DK", "finland": "FI",
    "poland": "PL", "turkey": "TR", "saudi arabia": "SA",
    "uae": "AE", "egypt": "EG", "south africa": "ZA",
    "nigeria": "NG", "kenya": "KE", "new zealand": "NZ",
    "argentina": "AR", "colombia": "CO", "chile": "CL",
    "peru": "PE", "pakistan": "PK", "bangladesh": "BD",
    "myanmar": "MM", "cambodia": "KH", "laos": "LA",
}


def _get_redis():
    settings = get_settings()
    return redis.from_url(settings.redis_url, decode_responses=True)


def _cache_key(keywords: list[str], country: str, days: int) -> str:
    kw = ",".join(sorted(k.lower().strip() for k in keywords))
    return f"gtrends:{country.lower()}:{days}:{kw}"


class GoogleTrendsService:

    async def get_trends(
        self,
        keywords: list[str],
        country: str = "",
        days: int = 90,
    ) -> dict:
        """Fetch Google Trends data. Returns cached result if available."""
        # Check cache first
        cache_k = _cache_key(keywords, country, days)
        try:
            r = _get_redis()
            cached = r.get(cache_k)
            if cached:
                logger.info("Google Trends cache hit: %s", cache_k)
                return json.loads(cached)
        except Exception:
            pass

        # Run blocking pytrends in thread executor
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, self._fetch_trends, keywords, country, days,
        )

        # Cache for 1 hour
        try:
            r = _get_redis()
            r.setex(cache_k, 3600, json.dumps(result, default=str))
        except Exception:
            pass

        return result

    def _fetch_trends(
        self,
        keywords: list[str],
        country: str,
        days: int,
    ) -> dict:
        try:
            from pytrends.request import TrendReq
        except ImportError:
            logger.warning("pytrends not installed — returning empty trends")
            return {
                "keywords": keywords,
                "country": country,
                "interest_over_time": [],
                "related_queries": {},
                "error": "pytrends library not installed",
            }

        geo = COUNTRY_CODES.get(country.lower().strip(), "")

        if days <= 30:
            timeframe = "today 1-m"
        elif days <= 90:
            timeframe = "today 3-m"
        elif days <= 180:
            timeframe = "today 6-m" if days <= 180 else "today 12-m"
        else:
            timeframe = "today 12-m"

        kw_list = [k.strip() for k in keywords[:5] if k.strip()]
        if not kw_list:
            return {
                "keywords": [],
                "country": country,
                "interest_over_time": [],
                "related_queries": {},
            }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                pytrends = TrendReq(hl="en-US", tz=480, timeout=(10, 30))
                pytrends.build_payload(kw_list, timeframe=timeframe, geo=geo)

                # Interest over time
                iot = pytrends.interest_over_time()
                interest_data = []
                if not iot.empty:
                    iot = iot.drop(columns=["isPartial"], errors="ignore")
                    for idx, row in iot.iterrows():
                        entry = {"date": idx.strftime("%Y-%m-%d")}
                        for kw in kw_list:
                            entry[kw] = int(row.get(kw, 0))
                        interest_data.append(entry)

                # Related queries
                related = {}
                try:
                    rq = pytrends.related_queries()
                    for kw in kw_list:
                        kw_data = rq.get(kw, {})
                        rising = kw_data.get("rising")
                        top = kw_data.get("top")
                        queries = []
                        if rising is not None and not rising.empty:
                            queries = rising["query"].tolist()[:10]
                        elif top is not None and not top.empty:
                            queries = top["query"].tolist()[:10]
                        related[kw] = queries
                except Exception as e:
                    logger.warning("Related queries failed: %s", e)

                return {
                    "keywords": kw_list,
                    "country": country,
                    "geo": geo,
                    "interest_over_time": interest_data,
                    "related_queries": related,
                }

            except Exception as e:
                logger.warning(
                    "Google Trends attempt %d/%d failed: %s",
                    attempt + 1, max_retries, e,
                )
                if attempt < max_retries - 1:
                    import time
                    time.sleep(2 * (attempt + 1))
                else:
                    return {
                        "keywords": kw_list,
                        "country": country,
                        "geo": geo,
                        "interest_over_time": [],
                        "related_queries": {},
                        "error": f"Google Trends unavailable: {str(e)}",
                    }
