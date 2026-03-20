"""add auto_order_trending_cooldown (was missing from 038)

Revision ID: 039
Revises: 038
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = '039'
down_revision = '038'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'auto_order_trending_cooldown'):
        op.add_column('fb_live_engage_sessions', sa.Column('auto_order_trending_cooldown', sa.Integer(), nullable=True, server_default='60'))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'auto_order_trending_cooldown')
