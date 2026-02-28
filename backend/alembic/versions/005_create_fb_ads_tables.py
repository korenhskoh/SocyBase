"""create facebook ads integration tables

Revision ID: 005
Revises: 004
Create Date: 2026-02-25

Creates all tables for FB Ads integration:
- Phase 1: fb_connections, fb_ad_accounts, fb_pages, fb_pixels
- Phase 2: fb_campaigns, fb_adsets, fb_ads, fb_insights
- Phase 3: fb_insight_scores
- Phase 4: fb_winning_ads
- Phase 5: ai_campaigns, ai_campaign_adsets, ai_campaign_ads
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- Phase 1 ----

    op.create_table(
        "fb_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("access_token_encrypted", sa.Text, nullable=False),
        sa.Column("token_expires_at", sa.DateTime(timezone=True)),
        sa.Column("fb_user_id", sa.String(50), nullable=False),
        sa.Column("fb_user_name", sa.String(200), nullable=False),
        sa.Column("scopes", postgresql.JSONB, server_default="[]"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("connected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "fb_ad_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(50), nullable=False, index=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("currency", sa.String(10), server_default="USD"),
        sa.Column("timezone_name", sa.String(100), server_default="UTC"),
        sa.Column("status", sa.String(30), server_default="ACTIVE"),
        sa.Column("is_selected", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "fb_pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("connection_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_id", sa.String(50), nullable=False, index=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("access_token_encrypted", sa.Text),
        sa.Column("category", sa.String(200)),
        sa.Column("picture_url", sa.Text),
        sa.Column("is_selected", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "fb_pixels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("ad_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pixel_id", sa.String(50), nullable=False, index=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("is_selected", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ---- Phase 2 ----

    op.create_table(
        "fb_campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("ad_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("campaign_id", sa.String(50), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("objective", sa.String(50)),
        sa.Column("status", sa.String(30), server_default="ACTIVE"),
        sa.Column("daily_budget", sa.Integer),
        sa.Column("lifetime_budget", sa.Integer),
        sa.Column("buying_type", sa.String(30)),
        sa.Column("created_time", sa.DateTime(timezone=True)),
        sa.Column("updated_time", sa.DateTime(timezone=True)),
        sa.Column("raw_data", postgresql.JSONB, server_default="{}"),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "fb_adsets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("adset_id", sa.String(50), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("status", sa.String(30), server_default="ACTIVE"),
        sa.Column("daily_budget", sa.Integer),
        sa.Column("targeting", postgresql.JSONB, server_default="{}"),
        sa.Column("optimization_goal", sa.String(50)),
        sa.Column("billing_event", sa.String(50)),
        sa.Column("bid_strategy", sa.String(50)),
        sa.Column("start_time", sa.DateTime(timezone=True)),
        sa.Column("end_time", sa.DateTime(timezone=True)),
        sa.Column("raw_data", postgresql.JSONB, server_default="{}"),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "fb_ads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("adset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_adsets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ad_id", sa.String(50), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("status", sa.String(30), server_default="ACTIVE"),
        sa.Column("creative_id", sa.String(50)),
        sa.Column("creative_data", postgresql.JSONB, server_default="{}"),
        sa.Column("raw_data", postgresql.JSONB, server_default="{}"),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "fb_insights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("object_type", sa.String(20), nullable=False),
        sa.Column("object_id", sa.String(50), nullable=False, index=True),
        sa.Column("date", sa.Date, nullable=False, index=True),
        sa.Column("spend", sa.Integer, server_default="0"),
        sa.Column("impressions", sa.Integer, server_default="0"),
        sa.Column("clicks", sa.Integer, server_default="0"),
        sa.Column("ctr", sa.Numeric(8, 4), server_default="0"),
        sa.Column("cpc", sa.Integer, server_default="0"),
        sa.Column("cpm", sa.Integer, server_default="0"),
        sa.Column("results", sa.Integer, server_default="0"),
        sa.Column("cost_per_result", sa.Integer, server_default="0"),
        sa.Column("purchase_value", sa.Integer, server_default="0"),
        sa.Column("roas", sa.Numeric(8, 4), server_default="0"),
        sa.Column("actions", postgresql.JSONB, server_default="{}"),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("object_type", "object_id", "date", name="uq_fb_insight_object_date"),
    )

    # ---- Phase 3 ----

    op.create_table(
        "fb_insight_scores",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("ad_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_type", sa.String(30), nullable=False),
        sa.Column("group_value", sa.Text, nullable=False),
        sa.Column("score", sa.Numeric(4, 2), server_default="0"),
        sa.Column("metrics", postgresql.JSONB, server_default="{}"),
        sa.Column("date_range_start", sa.Date, nullable=False),
        sa.Column("date_range_end", sa.Date, nullable=False),
        sa.Column("scored_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ---- Phase 4 ----

    op.create_table(
        "fb_winning_ads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("ad_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_ads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rank", sa.Integer, nullable=False),
        sa.Column("score", sa.Numeric(4, 2), server_default="0"),
        sa.Column("total_spend", sa.Integer, server_default="0"),
        sa.Column("total_results", sa.Integer, server_default="0"),
        sa.Column("cost_per_result", sa.Integer, server_default="0"),
        sa.Column("roas", sa.Numeric(8, 4), server_default="0"),
        sa.Column("ctr", sa.Numeric(8, 4), server_default="0"),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("criteria", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ---- Phase 5 ----

    op.create_table(
        "ai_campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("ad_account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_ad_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(30), server_default="draft"),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("objective", sa.String(50), nullable=False),
        sa.Column("daily_budget", sa.Integer, nullable=False),
        sa.Column("page_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_pages.id")),
        sa.Column("pixel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("fb_pixels.id")),
        sa.Column("conversion_event", sa.String(50)),
        sa.Column("landing_page_url", sa.Text),
        sa.Column("audience_strategy", sa.String(50), server_default="conservative"),
        sa.Column("creative_strategy", sa.String(50), server_default="proven_winners"),
        sa.Column("historical_data_range", sa.Integer, server_default="90"),
        sa.Column("custom_instructions", sa.Text),
        sa.Column("ai_summary", postgresql.JSONB),
        sa.Column("generation_progress", postgresql.JSONB),
        sa.Column("credits_used", sa.Integer, server_default="0"),
        sa.Column("meta_campaign_id", sa.String(50)),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "ai_campaign_adsets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("targeting", postgresql.JSONB, server_default="{}"),
        sa.Column("daily_budget", sa.Integer, nullable=False),
        sa.Column("meta_adset_id", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "ai_campaign_ads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("adset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_campaign_adsets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("headline", sa.Text, nullable=False),
        sa.Column("primary_text", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("creative_source", sa.String(50), server_default="ai_generated"),
        sa.Column("creative_ref_id", sa.String(50)),
        sa.Column("image_url", sa.Text),
        sa.Column("cta_type", sa.String(50), server_default="LEARN_MORE"),
        sa.Column("destination_url", sa.Text),
        sa.Column("meta_ad_id", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ai_campaign_ads")
    op.drop_table("ai_campaign_adsets")
    op.drop_table("ai_campaigns")
    op.drop_table("fb_winning_ads")
    op.drop_table("fb_insight_scores")
    op.drop_table("fb_insights")
    op.drop_table("fb_ads")
    op.drop_table("fb_adsets")
    op.drop_table("fb_campaigns")
    op.drop_table("fb_pixels")
    op.drop_table("fb_pages")
    op.drop_table("fb_ad_accounts")
    op.drop_table("fb_connections")
