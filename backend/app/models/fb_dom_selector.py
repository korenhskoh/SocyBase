"""Facebook DOM Selector Configuration — stores AI-verified selectors."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FBDOMSelector(Base):
    """Stores verified Facebook DOM selectors for warm-up actions."""

    __tablename__ = "fb_dom_selectors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # AI-verified selector data
    selectors: Mapped[dict] = mapped_column(JSONB, nullable=False)
    overall_confidence: Mapped[float] = mapped_column(Float, server_default="0.0")
    warnings: Mapped[dict | None] = mapped_column(JSONB)
    facebook_version: Mapped[str | None] = mapped_column(String(50))

    # Metadata
    verified_by_account: Mapped[str | None] = mapped_column(String(100))
    raw_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
