"""Re-export Celery tasks so that ``from app.scraping.tasks import …`` works.

The actual task implementations live in their respective pipeline modules
(pipeline.py and post_discovery_pipeline.py) but are registered under the
``app.scraping.tasks.*`` Celery task namespace.  This shim keeps the import
paths used by jobs.py and the scheduler consistent.
"""

from app.scraping.pipeline import run_scraping_pipeline, check_scheduled_jobs  # noqa: F401
from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline  # noqa: F401
