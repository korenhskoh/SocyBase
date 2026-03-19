"""add aggressive_level, quantity_variation, code_pattern to fb_live_engage_sessions

Revision ID: 029
Revises: 028
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'aggressive_level'):
        op.add_column('fb_live_engage_sessions', sa.Column('aggressive_level', sa.String(10), nullable=True, server_default='medium'))
    if not _col_exists('fb_live_engage_sessions', 'quantity_variation'):
        op.add_column('fb_live_engage_sessions', sa.Column('quantity_variation', sa.Boolean(), nullable=True, server_default='true'))
    if not _col_exists('fb_live_engage_sessions', 'code_pattern'):
        op.add_column('fb_live_engage_sessions', sa.Column('code_pattern', sa.String(500), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'code_pattern')
    op.drop_column('fb_live_engage_sessions', 'quantity_variation')
    op.drop_column('fb_live_engage_sessions', 'aggressive_level')
