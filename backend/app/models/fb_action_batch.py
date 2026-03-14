"""Facebook Action Bot — batch execution model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FBActionBatch(Base):
    """Tracks a batch of Facebook actions uploaded via CSV."""

    __tablename__ = "fb_action_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Job metadata
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    completed_rows: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)

    # Concurrency settings
    execution_mode: Mapped[str] = mapped_column(String(20), default="sequential")  # sequential | concurrent
    delay_seconds: Mapped[float] = mapped_column(Float, default=5.0)
    max_parallel: Mapped[int] = mapped_column(Integer, default=3)

    # Encrypted CSV data — Fernet-encrypted JSON of parsed rows; cleared after completion
    csv_data_encrypted: Mapped[str | None] = mapped_column(Text)

    # Shared proxy config fallback
    proxy_config: Mapped[dict | None] = mapped_column(JSONB)

    # Error info
    error_message: Mapped[str | None] = mapped_column(Text)

    # Celery task tracking
    celery_task_id: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
