"""add comment_message column to scraped_profiles

Revision ID: 041
Revises: 040
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa

revision = '041'
down_revision = '040'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    if not _col_exists('scraped_profiles', 'comment_message'):
        op.add_column('scraped_profiles', sa.Column('comment_message', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('scraped_profiles', 'comment_message')
