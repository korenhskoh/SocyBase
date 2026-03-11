"""Models for the Livestream Sell Helper feature."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LiveSession(Base):
    """Tracks a live-stream monitoring session."""

    __tablename__ = "live_sessions"
    __table_args__ = (
        Index("ix_live_sessions_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    fb_page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_pages.id", ondelete="CASCADE"), nullable=False
    )
    video_id: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="monitoring"
    )  # monitoring / stopped / completed
    celery_task_id: Mapped[str | None] = mapped_column(String(200))
    total_comments: Mapped[int] = mapped_column(Integer, default=0)
    total_orders: Mapped[int] = mapped_column(Integer, default=0)
    settings: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    comments = relationship("LiveComment", back_populates="session", cascade="all, delete-orphan")


class LiveComment(Base):
    """Individual comment from a live stream."""

    __tablename__ = "live_comments"
    __table_args__ = (
        Index("ix_live_comments_session_created", "session_id", "created_at"),
        Index("ix_live_comments_session_order", "session_id", "is_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False
    )
    fb_comment_id: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    commenter_id: Mapped[str] = mapped_column(String(100), nullable=False)
    commenter_name: Mapped[str] = mapped_column(String(300), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_order: Mapped[bool] = mapped_column(Boolean, default=False)
    matched_keywords: Mapped[dict | None] = mapped_column(JSONB)
    replied: Mapped[bool] = mapped_column(Boolean, default=False)
    reply_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    session = relationship("LiveSession", back_populates="comments")
