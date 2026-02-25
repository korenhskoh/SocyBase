"""Fan analysis cache model — stores AI analysis and bot detection results."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FanAnalysisCache(Base):
    __tablename__ = "fan_analysis_cache"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scraping_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    commenter_user_id: Mapped[str] = mapped_column(String(255), nullable=False)

    # AI analysis results
    buying_intent_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    interests: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sentiment: Mapped[str | None] = mapped_column(String(50), nullable=True)
    persona_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_phrases: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Bot detection
    bot_score: Mapped[float] = mapped_column(Float, default=0.0)
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False)
    bot_indicators: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Metadata
    analyzed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    token_cost: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_fan_analysis_tenant_job_user", "tenant_id", "job_id", "commenter_user_id"),
        Index("ix_fan_analysis_job_id", "job_id"),
    )
