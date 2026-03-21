"""add context_window to live engage sessions

Revision ID: 042
Revises: 041
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa

revision = '042'
down_revision = '041'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'context_window'):
        op.add_column('fb_live_engage_sessions', sa.Column('context_window', sa.Integer(), nullable=True, server_default='50'))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'context_window')
