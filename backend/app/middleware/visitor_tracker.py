"""
Lightweight visitor tracking middleware.
Stores active visitors in Redis with IP geolocation.
"""

import time
import logging
import hashlib
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import redis.asyncio as aioredis

from app.config import get_settings

logger = logging.getLogger(__name__)

REDIS_KEY = "socybase:active_visitors"
GEO_CACHE_KEY = "socybase:geo_cache"
VISITOR_TTL = 300  # 5 min — visitor considered "active" for 5 min after last request
GEO_CACHE_TTL = 86400  # 24h cache for IP geolocation

# Skip tracking for these paths
SKIP_PATHS = {"/health", "/docs", "/redoc", "/openapi.json", "/favicon.ico"}


def _get_client_ip(request: Request) -> str:
    """Extract real client IP from proxy headers."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


def _visitor_id(ip: str, ua: str) -> str:
    """Create anonymous visitor fingerprint from IP + user agent."""
    return hashlib.sha256(f"{ip}:{ua}".encode()).hexdigest()[:16]


async def _get_geo(r: aioredis.Redis, ip: str) -> dict:
    """Lookup IP geolocation with caching."""
    if ip in ("127.0.0.1", "::1", "unknown") or ip.startswith("10.") or ip.startswith("192.168."):
        return {"country": "Local", "city": "", "country_code": "", "lat": 0, "lon": 0}

    # Check cache
    cached = await r.hget(GEO_CACHE_KEY, ip)
    if cached:
        import json
        try:
            return json.loads(cached)
        except Exception:
            pass

    # Fetch from ip-api.com (free, 45 req/min)
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,city,regionName,lat,lon")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    geo = {
                        "country": data.get("country", ""),
                        "country_code": data.get("countryCode", ""),
                        "city": data.get("city", ""),
                        "region": data.get("regionName", ""),
                        "lat": data.get("lat", 0),
                        "lon": data.get("lon", 0),
                    }
                    import json
                    await r.hset(GEO_CACHE_KEY, ip, json.dumps(geo))
                    await r.expire(GEO_CACHE_KEY, GEO_CACHE_TTL)
                    return geo
    except Exception as e:
        logger.debug(f"Geo lookup failed for {ip}: {e}")

    return {"country": "Unknown", "city": "", "country_code": "", "lat": 0, "lon": 0}


class VisitorTrackingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, redis_url: str | None = None):
        super().__init__(app)
        settings = get_settings()
        self._redis_url = redis_url or settings.redis_url
        self._redis: aioredis.Redis | None = None

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Skip non-page/API requests
        path = request.url.path
        if any(path.startswith(s) for s in SKIP_PATHS) or path.startswith("/uploads"):
            return response

        # Track visitor in background (don't block response)
        try:
            ip = _get_client_ip(request)
            ua = request.headers.get("user-agent", "")
            vid = _visitor_id(ip, ua)
            now = time.time()

            r = await self._get_redis()
            import json

            geo = await _get_geo(r, ip)

            visitor_data = json.dumps({
                "vid": vid,
                "ip": ip,
                "path": path,
                "method": request.method,
                "ua": ua[:200],
                "geo": geo,
                "ts": now,
            })

            # Store in sorted set (score = timestamp) for automatic TTL via score range
            await r.zadd(REDIS_KEY, {visitor_data: now})

            # Clean up expired visitors (older than TTL)
            await r.zremrangebyscore(REDIS_KEY, 0, now - VISITOR_TTL)

        except Exception as e:
            logger.debug(f"Visitor tracking error: {e}")

        return response
