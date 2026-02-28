import asyncio
import time
import redis.asyncio as redis
from app.config import get_settings

settings = get_settings()

# Global asyncio semaphore to enforce max concurrent in-flight API requests
# across all tasks within a single worker process.  Since each Celery prefork
# worker creates its own event loop, this is per-worker.  The supplier limit
# (e.g. 4 concurrent connections) is shared across all workers, so set this
# to max_supplier_concurrency / celery_concurrency (or 2 to leave headroom).
_SUPPLIER_SEMAPHORE: asyncio.Semaphore | None = None


def get_supplier_semaphore(max_concurrent: int = 2) -> asyncio.Semaphore:
    """Get or create a per-event-loop semaphore for supplier concurrency."""
    global _SUPPLIER_SEMAPHORE
    if _SUPPLIER_SEMAPHORE is None:
        _SUPPLIER_SEMAPHORE = asyncio.Semaphore(max_concurrent)
    return _SUPPLIER_SEMAPHORE


class RateLimiter:
    """Redis-based sliding window rate limiter."""

    def __init__(self, redis_url: str | None = None):
        self.redis_url = redis_url or settings.redis_url
        self._redis: redis.Redis | None = None

    async def _get_redis(self) -> redis.Redis:
        if self._redis is None:
            self._redis = redis.from_url(self.redis_url, decode_responses=True)
        return self._redis

    async def acquire(
        self,
        key: str,
        max_requests: int,
        window_seconds: int = 1,
    ) -> bool:
        """
        Try to acquire a rate limit slot.
        Returns True if allowed, False if rate limited.
        """
        r = await self._get_redis()
        now = time.time()
        window_start = now - window_seconds

        pipe = r.pipeline()
        # Remove old entries
        pipe.zremrangebyscore(key, 0, window_start)
        # Count current entries
        pipe.zcard(key)
        # Add current request
        pipe.zadd(key, {str(now): now})
        # Set expiry
        pipe.expire(key, window_seconds + 1)
        results = await pipe.execute()

        current_count = results[1]
        return current_count < max_requests

    async def wait_for_slot(
        self,
        key: str,
        max_requests: int,
        window_seconds: int = 1,
        max_wait: float = 30.0,
    ) -> bool:
        """Wait until a rate limit slot is available."""
        start = time.time()
        while time.time() - start < max_wait:
            if await self.acquire(key, max_requests, window_seconds):
                return True
            await asyncio.sleep(0.1)
        return False

    async def wait_for_slot_tenant(
        self,
        tenant_id: str,
        max_requests_global: int,
        max_requests_tenant: int = 3,
        window_seconds: int = 1,
        max_wait: float = 30.0,
    ) -> bool:
        """Wait for both per-tenant AND global rate limit slots.

        Ensures no single tenant can monopolise the shared API quota.
        """
        global_key = "akng_api_global"
        tenant_key = f"akng_api:tenant:{tenant_id}"
        start = time.time()
        while time.time() - start < max_wait:
            tenant_ok = await self.acquire(tenant_key, max_requests_tenant, window_seconds)
            if tenant_ok:
                global_ok = await self.acquire(global_key, max_requests_global, window_seconds)
                if global_ok:
                    return True
            await asyncio.sleep(0.1)
        return False

    async def close(self):
        if self._redis:
            await self._redis.close()
