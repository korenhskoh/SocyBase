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


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'target_comments_enabled'):
        op.add_column('fb_live_engage_sessions', sa.Column('target_comments_enabled', sa.Boolean(), nullable=True, server_default='false'))
    if not _col_exists('fb_live_engage_sessions', 'target_comments_count'):
        op.add_column('fb_live_engage_sessions', sa.Column('target_comments_count', sa.Integer(), nullable=True))
    if not _col_exists('fb_live_engage_sessions', 'target_comments_period_minutes'):
        op.add_column('fb_live_engage_sessions', sa.Column('target_comments_period_minutes', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'target_comments_period_minutes')
    op.drop_column('fb_live_engage_sessions', 'target_comments_count')
    op.drop_column('fb_live_engage_sessions', 'target_comments_enabled')
