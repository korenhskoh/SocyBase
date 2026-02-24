import asyncio
import time
import redis.asyncio as redis
from app.config import get_settings

settings = get_settings()


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

    async def close(self):
        if self._redis:
            await self._redis.close()
