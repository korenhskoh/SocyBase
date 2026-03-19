"""add scrape_interval_seconds and page_owner_id to fb_live_engage_sessions

Revision ID: 027
Revises: 026a
Create Date: 2026-03-18
"""
from alembic import op
import sqlalchemy as sa

revision = '027'
down_revision = '026a'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'scrape_interval_seconds'):
        op.add_column('fb_live_engage_sessions', sa.Column('scrape_interval_seconds', sa.Integer(), nullable=True, server_default='8'))
    if not _col_exists('fb_live_engage_sessions', 'page_owner_id'):
        op.add_column('fb_live_engage_sessions', sa.Column('page_owner_id', sa.String(100), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'page_owner_id')
    op.drop_column('fb_live_engage_sessions', 'scrape_interval_seconds')
