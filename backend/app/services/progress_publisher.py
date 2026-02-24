"""Publish job progress updates to Redis pub/sub.

The SSE endpoint subscribes to the same channel and streams events to the
browser in real time.  This module is intended to be called from synchronous
Celery-worker code (the pipeline runs inside ``asyncio.run_until_complete``
but the publish itself is fire-and-forget), so it uses the *synchronous*
``redis`` client.
"""

import json
import logging

import redis

logger = logging.getLogger(__name__)


def publish_job_progress(job_id: str, data: dict) -> None:
    """Publish a progress payload on the ``job_progress:<job_id>`` channel."""
    from app.config import get_settings

    settings = get_settings()
    r = redis.from_url(settings.redis_url)
    channel = f"job_progress:{job_id}"
    try:
        r.publish(channel, json.dumps(data))
    except Exception:
        logger.warning("Failed to publish progress for job %s", job_id, exc_info=True)
    finally:
        r.close()
