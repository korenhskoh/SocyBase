"""Browser scrape tasks for Chrome extension-based Facebook scraping."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BrowserScrapeTask(Base):
    """Task queue entry for Chrome extension to fetch Facebook pages."""

    __tablename__ = "browser_scrape_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scraping_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )

    task_type: Mapped[str] = mapped_column(String(30), nullable=False)  # "scrape_comments" or "scrape_feed"
    target_url: Mapped[str] = mapped_column(Text, nullable=False)  # mbasic.facebook.com URL
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)  # pending / in_progress / completed / failed
    result_data: Mapped[dict | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
    limit: Mapped[int | None] = mapped_column(Integer)  # max items to scrape

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
