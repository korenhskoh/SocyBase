"""add track_host_product to sessions and presets

Revision ID: 044
Revises: 043
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = '044'
down_revision = '043'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'track_host_product'):
        op.add_column('fb_live_engage_sessions', sa.Column('track_host_product', sa.Boolean(), nullable=True, server_default='true'))
    if not _col_exists('fb_live_engage_presets', 'track_host_product'):
        op.add_column('fb_live_engage_presets', sa.Column('track_host_product', sa.Boolean(), nullable=True, server_default='true'))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'track_host_product')
    op.drop_column('fb_live_engage_presets', 'track_host_product')
