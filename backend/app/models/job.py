import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Text, Numeric
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ScrapingJob(Base):
    __tablename__ = "scraping_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    platform_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id"), nullable=False
    )
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)

    # Input
    input_type: Mapped[str] = mapped_column(String(30), nullable=False)
    input_value: Mapped[str] = mapped_column(Text, nullable=False)
    input_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Scheduling
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Progress
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    processed_items: Mapped[int] = mapped_column(Integer, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, default=0)
    progress_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)

    # Cost
    credits_estimated: Mapped[int] = mapped_column(Integer, default=0)
    credits_used: Mapped[int] = mapped_column(Integer, default=0)

    # Results
    result_file_url: Mapped[str | None] = mapped_column(Text)
    result_row_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    error_details: Mapped[dict | None] = mapped_column(JSONB)

    # Celery
    celery_task_id: Mapped[str | None] = mapped_column(String(255), index=True)

    # Settings
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    tenant = relationship("Tenant", back_populates="scraping_jobs")
    user = relationship("User", back_populates="scraping_jobs")
    platform = relationship("Platform")
    scraped_profiles = relationship("ScrapedProfile", back_populates="job", cascade="all, delete-orphan")
    extracted_comments = relationship("ExtractedComment", back_populates="job", cascade="all, delete-orphan")
    scraped_posts = relationship("ScrapedPost", back_populates="job", cascade="all, delete-orphan")
    page_author_profile = relationship("PageAuthorProfile", back_populates="job", uselist=False, cascade="all, delete-orphan")


class ScrapedProfile(Base):
    __tablename__ = "scraped_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scraping_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    platform_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    raw_data: Mapped[dict | None] = mapped_column(JSONB)

    # Standard 18-field format
    name: Mapped[str | None] = mapped_column(String(255))
    first_name: Mapped[str | None] = mapped_column(String(255))
    last_name: Mapped[str | None] = mapped_column(String(255))
    gender: Mapped[str | None] = mapped_column(String(50))
    birthday: Mapped[str | None] = mapped_column(String(100))
    relationship_status: Mapped[str | None] = mapped_column("relationship", String(255))
    education: Mapped[str | None] = mapped_column(Text)
    work: Mapped[str | None] = mapped_column(Text)
    position: Mapped[str | None] = mapped_column(String(255))
    hometown: Mapped[str | None] = mapped_column(String(255))
    location: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(Text)
    languages: Mapped[str | None] = mapped_column(Text)
    username_link: Mapped[str | None] = mapped_column(Text)
    username: Mapped[str | None] = mapped_column(String(255))
    about: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(100))
    picture_url: Mapped[str | None] = mapped_column(Text)

    scrape_status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text)
    scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    job = relationship("ScrapingJob", back_populates="scraped_profiles")


class ExtractedComment(Base):
    __tablename__ = "extracted_comments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scraping_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    post_id: Mapped[str] = mapped_column(String(255), nullable=False)
    comment_id: Mapped[str] = mapped_column(String(255), nullable=False)
    commenter_user_id: Mapped[str | None] = mapped_column(String(255))
    commenter_name: Mapped[str | None] = mapped_column(String(255))
    comment_text: Mapped[str | None] = mapped_column(Text)
    comment_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    job = relationship("ScrapingJob", back_populates="extracted_comments")


class ScrapedPost(Base):
    __tablename__ = "scraped_posts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scraping_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )

    # Post data from AKNG API
    post_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    message: Mapped[str | None] = mapped_column(Text)
    created_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Author info
    from_name: Mapped[str | None] = mapped_column(String(255))
    from_id: Mapped[str | None] = mapped_column(String(255))

    # Engagement metrics
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    reaction_count: Mapped[int] = mapped_column(Integer, default=0)
    share_count: Mapped[int] = mapped_column(Integer, default=0)

    # Attachments
    attachment_type: Mapped[str | None] = mapped_column(String(50))
    attachment_url: Mapped[str | None] = mapped_column(Text)

    # Computed
    post_url: Mapped[str | None] = mapped_column(Text)

    # Raw API response
    raw_data: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    job = relationship("ScrapingJob", back_populates="scraped_posts")


class PageAuthorProfile(Base):
    __tablename__ = "page_author_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scraping_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )

    platform_object_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    about: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(100))
    website: Mapped[str | None] = mapped_column(Text)
    picture_url: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(Text)
    raw_data: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    job = relationship("ScrapingJob", back_populates="page_author_profile")
