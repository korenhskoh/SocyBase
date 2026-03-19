"""add target_comments fields to fb_live_engage_sessions

Revision ID: 031
Revises: 030
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = '031'
down_revision = '030'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fb_live_engage_sessions', sa.Column('target_comments_enabled', sa.Boolean(), nullable=True, server_default='false'))
    op.add_column('fb_live_engage_sessions', sa.Column('target_comments_count', sa.Integer(), nullable=True))
    op.add_column('fb_live_engage_sessions', sa.Column('target_comments_period_minutes', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'target_comments_period_minutes')
    op.drop_column('fb_live_engage_sessions', 'target_comments_count')
    op.drop_column('fb_live_engage_sessions', 'target_comments_enabled')
