"""add comment_without_new fields to sessions and presets

Revision ID: 035
Revises: 034
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = '035'
down_revision = '034'
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
        if not _col_exists(table, 'comment_without_new'):
            op.add_column(table, sa.Column('comment_without_new', sa.Boolean(), nullable=True, server_default='false'))
        if not _col_exists(table, 'comment_without_new_max'):
            op.add_column(table, sa.Column('comment_without_new_max', sa.Integer(), nullable=True, server_default='3'))


def downgrade():
    for table in ('fb_live_engage_sessions', 'fb_live_engage_presets'):
        op.drop_column(table, 'comment_without_new_max')
        op.drop_column(table, 'comment_without_new')
