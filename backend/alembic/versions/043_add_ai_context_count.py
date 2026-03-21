"""add ai_context_count to sessions and presets

Revision ID: 043
Revises: 042
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa

revision = '043'
down_revision = '042'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'ai_context_count'):
        op.add_column('fb_live_engage_sessions', sa.Column('ai_context_count', sa.Integer(), nullable=True, server_default='15'))
    if not _col_exists('fb_live_engage_presets', 'ai_context_count'):
        op.add_column('fb_live_engage_presets', sa.Column('ai_context_count', sa.Integer(), nullable=True, server_default='15'))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'ai_context_count')
    op.drop_column('fb_live_engage_presets', 'ai_context_count')
