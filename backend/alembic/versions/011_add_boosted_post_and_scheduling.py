"""Add boosted post and scheduling fields to ai_campaigns

Revision ID: 011
Revises: 010
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade():
    # Add boosted_post_id, schedule_start_time, schedule_end_time, custom_audience_id, boost_goal, and audience_type to ai_campaigns
    op.add_column('ai_campaigns', sa.Column('boosted_post_id', sa.String(length=100), nullable=True))
    op.add_column('ai_campaigns', sa.Column('schedule_start_time', sa.DateTime(timezone=True), nullable=True))
    op.add_column('ai_campaigns', sa.Column('schedule_end_time', sa.DateTime(timezone=True), nullable=True))
    op.add_column('ai_campaigns', sa.Column('custom_audience_id', sa.String(length=100), nullable=True))
    op.add_column('ai_campaigns', sa.Column('boost_goal', sa.String(length=50), nullable=True))
    op.add_column('ai_campaigns', sa.Column('audience_type', sa.String(length=50), nullable=True))


def downgrade():
    # Remove the added columns
    op.drop_column('ai_campaigns', 'audience_type')
    op.drop_column('ai_campaigns', 'boost_goal')
    op.drop_column('ai_campaigns', 'custom_audience_id')
    op.drop_column('ai_campaigns', 'schedule_end_time')
    op.drop_column('ai_campaigns', 'schedule_start_time')
    op.drop_column('ai_campaigns', 'boosted_post_id')
