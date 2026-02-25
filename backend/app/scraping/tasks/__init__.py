# Re-export Celery tasks so autodiscover finds them
from app.scraping.pipeline import run_scraping_pipeline, check_scheduled_jobs
from app.scraping.post_discovery_pipeline import run_post_discovery_pipeline
from app.scraping.fan_analysis_task import run_fan_analysis_batch

__all__ = ["run_scraping_pipeline", "check_scheduled_jobs", "run_post_discovery_pipeline", "run_fan_analysis_batch"]
