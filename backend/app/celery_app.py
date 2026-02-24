from celery import Celery
from celery.schedules import crontab
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "socybase",
    broker=settings.effective_celery_broker_url,
    backend=settings.effective_celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=86400,  # 24 hours
    task_routes={
        "app.scraping.tasks.*": {"queue": "scraping"},
        "app.services.*": {"queue": "default"},
    },
)

# Celery Beat schedule for periodic tasks
celery_app.conf.beat_schedule = {
    "check-scheduled-jobs": {
        "task": "app.scraping.tasks.check_scheduled_jobs",
        "schedule": crontab(minute="*/1"),  # Every minute
    },
}

# Auto-discover tasks
celery_app.autodiscover_tasks([
    "app.scraping.tasks",
    "app.services",
])
