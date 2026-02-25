"""Celery task for batch AI fan analysis."""

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.scraping.tasks.run_fan_analysis_batch")
def run_fan_analysis_batch(self, job_id: str, tenant_id: str, min_comments: int = 3, limit: int = 50):
    """Batch analyse top fans for a job using OpenAI."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(
            _execute_batch_analysis(self, job_id, tenant_id, min_comments, limit)
        )
    finally:
        loop.close()


async def _execute_batch_analysis(celery_task, job_id_str: str, tenant_id_str: str, min_comments: int, limit: int):
    from sqlalchemy import func, select
    from app.config import get_settings
    from app.database import async_session
    from app.models.fan_analysis import FanAnalysisCache
    from app.models.job import ExtractedComment
    from app.models.tenant import Tenant
    from app.services.openai_service import OpenAIService
    from app.services.progress_publisher import publish_job_progress

    settings = get_settings()
    job_id = UUID(job_id_str)
    tenant_id = UUID(tenant_id_str)

    async with async_session() as db:
        # Get business context
        tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one_or_none()
        biz = (tenant.settings or {}).get("business", {}) if tenant else {}
        business_ctx = biz.get("business_name", "") or ""

        # Find top fans by comment count, excluding already-analyzed
        already_analyzed = select(FanAnalysisCache.commenter_user_id).where(
            FanAnalysisCache.job_id == job_id,
            FanAnalysisCache.buying_intent_score.is_not(None),
        )

        fan_stmt = (
            select(
                ExtractedComment.commenter_user_id,
                func.max(ExtractedComment.commenter_name).label("name"),
                func.count().label("cnt"),
            )
            .where(
                ExtractedComment.job_id == job_id,
                ExtractedComment.commenter_user_id.is_not(None),
                ExtractedComment.commenter_user_id != "",
                ExtractedComment.commenter_user_id.notin_(already_analyzed),
            )
            .group_by(ExtractedComment.commenter_user_id)
            .having(func.count() >= min_comments)
            .order_by(func.count().desc())
            .limit(limit)
        )
        fan_rows = (await db.execute(fan_stmt)).all()

        if not fan_rows:
            logger.info(f"[FanAnalysis {job_id}] No fans to analyze")
            return

        openai_svc = OpenAIService(api_key=settings.openai_api_key)
        total = len(fan_rows)
        analyzed = 0

        for idx, row in enumerate(fan_rows):
            uid = row.commenter_user_id
            fan_name = row.name or "Unknown"

            # Fetch comments
            comments_stmt = (
                select(ExtractedComment.comment_text)
                .where(
                    ExtractedComment.job_id == job_id,
                    ExtractedComment.commenter_user_id == uid,
                    ExtractedComment.comment_text.is_not(None),
                )
                .order_by(ExtractedComment.comment_time.desc())
                .limit(50)
            )
            texts = [r[0] for r in (await db.execute(comments_stmt)).all() if r[0]]

            if not texts:
                continue

            analysis = await openai_svc.analyze_fan_comments(
                comments=texts,
                fan_name=fan_name,
                business_context=business_ctx,
            )

            cache = FanAnalysisCache(
                tenant_id=tenant_id,
                job_id=job_id,
                commenter_user_id=uid,
                buying_intent_score=analysis.get("buying_intent_score", 0),
                interests=analysis.get("interests", []),
                sentiment=analysis.get("sentiment", "neutral"),
                persona_type=analysis.get("persona_type", "casual"),
                ai_summary=analysis.get("summary", ""),
                key_phrases=analysis.get("key_phrases", []),
                analyzed_at=datetime.now(timezone.utc),
                token_cost=analysis.get("token_cost", 0),
            )
            db.add(cache)
            await db.flush()
            analyzed += 1

            # Publish progress
            publish_job_progress(str(job_id), {
                "status": "running",
                "current_stage": "ai_fan_analysis",
                "progress_pct": round((idx + 1) / total * 100, 1),
                "stage_data": {
                    "analyzed": analyzed,
                    "total": total,
                    "current_fan": fan_name,
                },
            })

            celery_task.update_state(
                state="PROGRESS",
                meta={"analyzed": analyzed, "total": total},
            )

        await db.commit()
        logger.info(f"[FanAnalysis {job_id}] Batch analysis complete: {analyzed}/{total} fans")

        publish_job_progress(str(job_id), {
            "status": "completed",
            "current_stage": "ai_fan_analysis",
            "progress_pct": 100,
            "stage_data": {"analyzed": analyzed, "total": total},
        })
