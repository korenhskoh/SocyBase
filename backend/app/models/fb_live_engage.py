"""Models for Livestream Engagement — AI-powered bulk comment boosting."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

DEFAULT_ROLE_DISTRIBUTION = {
    "ask_question": 10,
    "place_order": 10,
    "repeat_question": 20,
    "good_vibe": 30,
    "react_comment": 15,
    "share_experience": 15,
}

VALID_ROLES = set(DEFAULT_ROLE_DISTRIBUTION.keys())


class FBLiveEngageSession(Base):
    """Tracks a livestream engagement session with bulk accounts."""

    __tablename__ = "fb_live_engage_sessions"
    __table_args__ = (
        Index("ix_fb_live_engage_sessions_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    login_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_login_batches.id"), nullable=True
    )

    # Direct accounts — encrypted JSON array of {cookies, email, token, proxy, user_agent}
    direct_accounts_encrypted: Mapped[str | None] = mapped_column(Text)

    # Target — user provides URL or post_id
    post_id: Mapped[str] = mapped_column(String(200), nullable=False)
    post_url: Mapped[str | None] = mapped_column(String(500))
    title: Mapped[str | None] = mapped_column(String(500))

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    celery_task_id: Mapped[str | None] = mapped_column(String(255))
    error_message: Mapped[str | None] = mapped_column(Text)

    # Role distribution (JSONB) — values are percentages that sum to 100
    role_distribution: Mapped[dict] = mapped_column(JSONB, default=DEFAULT_ROLE_DISTRIBUTION.copy)

    # AI config
    business_context: Mapped[str] = mapped_column(Text, default="")
    training_comments: Mapped[str | None] = mapped_column(Text)
    ai_instructions: Mapped[str] = mapped_column(Text, default="")
    product_codes: Mapped[str | None] = mapped_column(Text)
    code_pattern: Mapped[str | None] = mapped_column(String(500))
    quantity_variation: Mapped[bool] = mapped_column(Boolean, default=True)
    languages: Mapped[str | None] = mapped_column(String(100))  # comma-separated: chinese,malay,english
    blacklist_words: Mapped[str | None] = mapped_column(Text)  # comma-separated words to avoid
    comment_without_new: Mapped[bool] = mapped_column(Boolean, default=False)
    comment_without_new_max: Mapped[int] = mapped_column(Integer, default=3)

    # Page owner — comments from this ID are ignored (livestream host)
    page_owner_id: Mapped[str | None] = mapped_column(String(100))

    # Timing & aggression
    aggressive_level: Mapped[str] = mapped_column(String(10), default="medium")
    scrape_interval_seconds: Mapped[int] = mapped_column(Integer, default=8)
    min_delay_seconds: Mapped[int] = mapped_column(Integer, default=15)
    max_delay_seconds: Mapped[int] = mapped_column(Integer, default=60)
    max_duration_minutes: Mapped[int] = mapped_column(Integer, default=180)
    stream_end_threshold: Mapped[int] = mapped_column(Integer, default=10)  # consecutive empty polls to auto-stop

    # Target comments — optional pacing mode
    target_comments_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    target_comments_count: Mapped[int | None] = mapped_column(Integer)
    target_comments_period_minutes: Mapped[int | None] = mapped_column(Integer)

    # Scheduled start
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Live metrics (updated periodically by task)
    live_metrics: Mapped[dict | None] = mapped_column(JSONB)

    # Stats
    total_comments_posted: Mapped[int] = mapped_column(Integer, default=0)
    total_errors: Mapped[int] = mapped_column(Integer, default=0)
    comments_by_role: Mapped[dict] = mapped_column(JSONB, default=dict)
    active_accounts: Mapped[int] = mapped_column(Integer, default=0)
    comments_monitored: Mapped[int] = mapped_column(Integer, default=0)

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    logs = relationship("FBLiveEngageLog", back_populates="session", cascade="all, delete-orphan")


class FBLiveEngageLog(Base):
    """Individual action log for a livestream engagement session."""

    __tablename__ = "fb_live_engage_logs"
    __table_args__ = (
        Index("ix_fb_live_engage_logs_session_created", "session_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_live_engage_sessions.id", ondelete="CASCADE"), nullable=False
    )

    role: Mapped[str] = mapped_column(String(30), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    account_email: Mapped[str] = mapped_column(String(255), nullable=False)

    reference_comment: Mapped[str | None] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(20), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    response_data: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    session = relationship("FBLiveEngageSession", back_populates="logs")


class FBLiveEngagePreset(Base):
    """Saved session configuration template for quick reuse."""

    __tablename__ = "fb_live_engage_presets"
    __table_args__ = (
        Index("ix_fb_live_engage_presets_tenant", "tenant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    role_distribution: Mapped[dict | None] = mapped_column(JSONB)
    business_context: Mapped[str] = mapped_column(Text, default="")
    training_comments: Mapped[str | None] = mapped_column(Text)
    ai_instructions: Mapped[str] = mapped_column(Text, default="")
    product_codes: Mapped[str | None] = mapped_column(Text)
    code_pattern: Mapped[str | None] = mapped_column(String(500))
    quantity_variation: Mapped[bool] = mapped_column(Boolean, default=True)
    aggressive_level: Mapped[str] = mapped_column(String(10), default="medium")
    scrape_interval_seconds: Mapped[int] = mapped_column(Integer, default=8)
    min_delay_seconds: Mapped[int] = mapped_column(Integer, default=15)
    max_delay_seconds: Mapped[int] = mapped_column(Integer, default=60)
    max_duration_minutes: Mapped[int] = mapped_column(Integer, default=180)
    target_comments_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    target_comments_count: Mapped[int | None] = mapped_column(Integer)
    target_comments_period_minutes: Mapped[int | None] = mapped_column(Integer)
    languages: Mapped[str | None] = mapped_column(String(100))
    blacklist_words: Mapped[str | None] = mapped_column(Text)
    comment_without_new: Mapped[bool] = mapped_column(Boolean, default=False)
    comment_without_new_max: Mapped[int] = mapped_column(Integer, default=3)
    stream_end_threshold: Mapped[int] = mapped_column(Integer, default=10)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
