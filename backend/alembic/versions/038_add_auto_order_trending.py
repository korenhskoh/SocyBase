"""add auto_order_trending fields to sessions

Revision ID: 038
Revises: 037
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = '038'
down_revision = '037'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'auto_order_trending'):
        op.add_column('fb_live_engage_sessions', sa.Column('auto_order_trending', sa.Boolean(), nullable=True, server_default='false'))
    if not _col_exists('fb_live_engage_sessions', 'auto_order_trending_threshold'):
        op.add_column('fb_live_engage_sessions', sa.Column('auto_order_trending_threshold', sa.Integer(), nullable=True, server_default='3'))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'auto_order_trending_threshold')
    op.drop_column('fb_live_engage_sessions', 'auto_order_trending')
