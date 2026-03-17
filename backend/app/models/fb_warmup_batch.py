"""Facebook Warm-Up — batch job model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FBWarmupBatch(Base):
    """Tracks a bulk Facebook warm-up job."""

    __tablename__ = "fb_warmup_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Source login batch
    login_batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_login_batches.id", ondelete="CASCADE"), nullable=False
    )

    # Job metadata
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    preset: Mapped[str] = mapped_column(String(20), nullable=False, default="light")
    total_accounts: Mapped[int] = mapped_column(Integer, default=0)
    completed_accounts: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)

    # Settings
    delay_seconds: Mapped[float] = mapped_column(Float, default=10.0)
    config: Mapped[dict | None] = mapped_column(JSONB)

    # Error info
    error_message: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
