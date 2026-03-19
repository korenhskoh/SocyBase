"""add product_codes to fb_live_engage_sessions

Revision ID: 028
Revises: 027
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = '028'
down_revision = '027'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('fb_live_engage_sessions', 'product_codes'):
        op.add_column('fb_live_engage_sessions', sa.Column('product_codes', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'product_codes')
