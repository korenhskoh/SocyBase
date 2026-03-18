"""add product_codes to fb_live_engage_sessions

Revision ID: 027
Revises: 026
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = '027'
down_revision = '026'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fb_live_engage_sessions', sa.Column('product_codes', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'product_codes')
