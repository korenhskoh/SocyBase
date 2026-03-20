"""add languages to fb_live_engage_sessions and presets

Revision ID: 036
Revises: 035
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = '036'
down_revision = '035'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    for table in ('fb_live_engage_sessions', 'fb_live_engage_presets'):
        if not _col_exists(table, 'languages'):
            op.add_column(table, sa.Column('languages', sa.String(100), nullable=True))


def downgrade():
    for table in ('fb_live_engage_sessions', 'fb_live_engage_presets'):
        op.drop_column(table, 'languages')
