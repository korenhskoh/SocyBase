"""add pending_actions to fb_live_engage_sessions for live control

Revision ID: 037
Revises: 036
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '037'
down_revision = '036'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'pending_actions'):
        op.add_column('fb_live_engage_sessions', sa.Column('pending_actions', JSONB(), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'pending_actions')
