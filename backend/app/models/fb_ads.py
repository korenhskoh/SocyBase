"""Facebook Ads integration models — connections, ad accounts, pages, pixels,
campaigns, ad sets, ads, insights, scoring, winning ads, and AI campaigns."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ---------------------------------------------------------------------------
# Phase 1: Connection & account selection
# ---------------------------------------------------------------------------

class FBConnection(Base):
    """Stores encrypted OAuth tokens for a tenant's Facebook connection."""

    __tablename__ = "fb_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fb_user_id: Mapped[str] = mapped_column(String(50), nullable=False)
    fb_user_name: Mapped[str] = mapped_column(String(200), nullable=False)
    scopes: Mapped[dict] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    # relationships
    ad_accounts = relationship("FBAdAccount", back_populates="connection", cascade="all, delete-orphan")
    pages = relationship("FBPage", back_populates="connection", cascade="all, delete-orphan")


class FBAdAccount(Base):
    """A Facebook Ad Account linked to a connection."""

    __tablename__ = "fb_ad_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_connections.id", ondelete="CASCADE"), nullable=False
    )
    account_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # act_123456789
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    timezone_name: Mapped[str] = mapped_column(String(100), default="UTC")
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    is_selected: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    # relationships
    connection = relationship("FBConnection", back_populates="ad_accounts")
    pixels = relationship("FBPixel", back_populates="ad_account", cascade="all, delete-orphan")
    campaigns = relationship("FBCampaign", back_populates="ad_account", cascade="all, delete-orphan")


class FBPage(Base):
    """A Facebook Page available through the connection."""

    __tablename__ = "fb_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_connections.id", ondelete="CASCADE"), nullable=False
    )
    page_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    access_token_encrypted: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(200))
    picture_url: Mapped[str | None] = mapped_column(Text)
    is_selected: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # relationships
    connection = relationship("FBConnection", back_populates="pages")


class FBPixel(Base):
    """A Meta Pixel attached to an ad account."""

    __tablename__ = "fb_pixels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False
    )
    pixel_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    is_selected: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # relationships
    ad_account = relationship("FBAdAccount", back_populates="pixels")


# ---------------------------------------------------------------------------
# Phase 2: Campaigns, Ad Sets, Ads, Insights
# ---------------------------------------------------------------------------

class FBCampaign(Base):
    __tablename__ = "fb_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False
    )
    campaign_id: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    daily_budget: Mapped[int | None] = mapped_column(Integer)
    lifetime_budget: Mapped[int | None] = mapped_column(Integer)
    buying_type: Mapped[str | None] = mapped_column(String(30))
    created_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    ad_account = relationship("FBAdAccount", back_populates="campaigns")
    adsets = relationship("FBAdSet", back_populates="campaign", cascade="all, delete-orphan")


class FBAdSet(Base):
    __tablename__ = "fb_adsets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_campaigns.id", ondelete="CASCADE"), nullable=False
    )
    adset_id: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    daily_budget: Mapped[int | None] = mapped_column(Integer)
    targeting: Mapped[dict] = mapped_column(JSONB, default=dict)
    optimization_goal: Mapped[str | None] = mapped_column(String(50))
    billing_event: Mapped[str | None] = mapped_column(String(50))
    bid_strategy: Mapped[str | None] = mapped_column(String(50))
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    campaign = relationship("FBCampaign", back_populates="adsets")
    ads = relationship("FBAd", back_populates="adset", cascade="all, delete-orphan")


class FBAd(Base):
    __tablename__ = "fb_ads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    adset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_adsets.id", ondelete="CASCADE"), nullable=False
    )
    ad_id: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    creative_id: Mapped[str | None] = mapped_column(String(50))
    creative_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    raw_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    adset = relationship("FBAdSet", back_populates="ads")


class FBInsight(Base):
    """Daily performance metrics per campaign/adset/ad."""

    __tablename__ = "fb_insights"
    __table_args__ = (
        UniqueConstraint("object_type", "object_id", "date", name="uq_fb_insight_object_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_type: Mapped[str] = mapped_column(String(20), nullable=False)  # campaign, adset, ad
    object_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)

    spend: Mapped[int] = mapped_column(Integer, default=0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    ctr: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=0)
    cpc: Mapped[int] = mapped_column(Integer, default=0)
    cpm: Mapped[int] = mapped_column(Integer, default=0)
    results: Mapped[int] = mapped_column(Integer, default=0)
    cost_per_result: Mapped[int] = mapped_column(Integer, default=0)
    purchase_value: Mapped[int] = mapped_column(Integer, default=0)
    roas: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=0)
    actions: Mapped[dict] = mapped_column(JSONB, default=dict)

    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Phase 3: AI Insight Scores
# ---------------------------------------------------------------------------

class FBInsightScore(Base):
    __tablename__ = "fb_insight_scores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False
    )
    group_type: Mapped[str] = mapped_column(String(30), nullable=False)
    group_value: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=0)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    date_range_start: Mapped[datetime] = mapped_column(Date, nullable=False)
    date_range_end: Mapped[datetime] = mapped_column(Date, nullable=False)
    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Phase 4: Winning Ads
# ---------------------------------------------------------------------------

class FBWinningAd(Base):
    __tablename__ = "fb_winning_ads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ad_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_ads.id", ondelete="CASCADE"), nullable=False
    )
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=0)
    total_spend: Mapped[int] = mapped_column(Integer, default=0)
    total_results: Mapped[int] = mapped_column(Integer, default=0)
    cost_per_result: Mapped[int] = mapped_column(Integer, default=0)
    roas: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=0)
    ctr: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=0)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    criteria: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    ad = relationship("FBAd")


# ---------------------------------------------------------------------------
# Phase 5: AI Campaign Builder
# ---------------------------------------------------------------------------

class AICampaign(Base):
    __tablename__ = "ai_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    ad_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(30), default="draft")
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    objective: Mapped[str] = mapped_column(String(50), nullable=False)
    daily_budget: Mapped[int] = mapped_column(Integer, nullable=False)
    page_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("fb_pages.id"))
    pixel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("fb_pixels.id"))
    conversion_event: Mapped[str | None] = mapped_column(String(50))
    landing_page_url: Mapped[str | None] = mapped_column(Text)
    audience_strategy: Mapped[str] = mapped_column(String(50), default="conservative")
    creative_strategy: Mapped[str] = mapped_column(String(50), default="proven_winners")
    historical_data_range: Mapped[int] = mapped_column(Integer, default=90)
    custom_instructions: Mapped[str | None] = mapped_column(Text)
    ai_summary: Mapped[dict | None] = mapped_column(JSONB)
    generation_progress: Mapped[dict | None] = mapped_column(JSONB)
    credits_used: Mapped[int] = mapped_column(Integer, default=0)
    meta_campaign_id: Mapped[str | None] = mapped_column(String(50))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    adsets = relationship("AICampaignAdSet", back_populates="campaign", cascade="all, delete-orphan")


class AICampaignAdSet(Base):
    __tablename__ = "ai_campaign_adsets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_campaigns.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    targeting: Mapped[dict] = mapped_column(JSONB, default=dict)
    daily_budget: Mapped[int] = mapped_column(Integer, nullable=False)
    meta_adset_id: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    campaign = relationship("AICampaign", back_populates="adsets")
    ads = relationship("AICampaignAd", back_populates="adset", cascade="all, delete-orphan")


class AICampaignAd(Base):
    __tablename__ = "ai_campaign_ads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    adset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_campaign_adsets.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    headline: Mapped[str] = mapped_column(Text, nullable=False)
    primary_text: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    creative_source: Mapped[str] = mapped_column(String(50), default="ai_generated")
    creative_ref_id: Mapped[str | None] = mapped_column(String(50))
    image_url: Mapped[str | None] = mapped_column(Text)
    cta_type: Mapped[str] = mapped_column(String(50), default="LEARN_MORE")
    destination_url: Mapped[str | None] = mapped_column(Text)
    meta_ad_id: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    adset = relationship("AICampaignAdSet", back_populates="ads")
