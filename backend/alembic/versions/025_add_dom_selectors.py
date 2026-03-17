"""add fb_dom_selectors table

Revision ID: 025
Revises: 024
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '025'
down_revision = '024'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fb_dom_selectors',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('selectors', JSONB, nullable=False),
        sa.Column('overall_confidence', sa.Float(), server_default='0.0'),
        sa.Column('warnings', JSONB),
        sa.Column('facebook_version', sa.String(50)),
        sa.Column('verified_by_account', sa.String(100)),
        sa.Column('raw_snapshot', JSONB),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('verified_at', sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_table('fb_dom_selectors')
