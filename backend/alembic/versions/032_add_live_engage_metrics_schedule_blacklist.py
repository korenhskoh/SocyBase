"""add live_metrics, scheduled_at, blacklist_words, stream_end_threshold to sessions

Revision ID: 032
Revises: 031
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fb_live_engage_sessions', sa.Column('live_metrics', JSONB(), nullable=True))
    op.add_column('fb_live_engage_sessions', sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('fb_live_engage_sessions', sa.Column('blacklist_words', sa.Text(), nullable=True))
    op.add_column('fb_live_engage_sessions', sa.Column('stream_end_threshold', sa.Integer(), nullable=True, server_default='10'))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'stream_end_threshold')
    op.drop_column('fb_live_engage_sessions', 'blacklist_words')
    op.drop_column('fb_live_engage_sessions', 'scheduled_at')
    op.drop_column('fb_live_engage_sessions', 'live_metrics')
