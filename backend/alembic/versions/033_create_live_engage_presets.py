"""create fb_live_engage_presets table

Revision ID: 033
Revises: 032
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '033'
down_revision = '032'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fb_live_engage_presets',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('role_distribution', JSONB()),
        sa.Column('business_context', sa.Text(), server_default=''),
        sa.Column('training_comments', sa.Text()),
        sa.Column('ai_instructions', sa.Text(), server_default=''),
        sa.Column('product_codes', sa.Text()),
        sa.Column('code_pattern', sa.String(500)),
        sa.Column('quantity_variation', sa.Boolean(), server_default='true'),
        sa.Column('aggressive_level', sa.String(10), server_default='medium'),
        sa.Column('scrape_interval_seconds', sa.Integer(), server_default='8'),
        sa.Column('min_delay_seconds', sa.Integer(), server_default='15'),
        sa.Column('max_delay_seconds', sa.Integer(), server_default='60'),
        sa.Column('max_duration_minutes', sa.Integer(), server_default='180'),
        sa.Column('target_comments_enabled', sa.Boolean(), server_default='false'),
        sa.Column('target_comments_count', sa.Integer()),
        sa.Column('target_comments_period_minutes', sa.Integer()),
        sa.Column('blacklist_words', sa.Text()),
        sa.Column('stream_end_threshold', sa.Integer(), server_default='10'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_fb_live_engage_presets_tenant', 'fb_live_engage_presets', ['tenant_id'])


def downgrade():
    op.drop_index('ix_fb_live_engage_presets_tenant', table_name='fb_live_engage_presets')
    op.drop_table('fb_live_engage_presets')
