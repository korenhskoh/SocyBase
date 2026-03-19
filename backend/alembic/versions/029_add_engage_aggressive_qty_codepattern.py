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


def upgrade():
    op.add_column('fb_live_engage_sessions', sa.Column('aggressive_level', sa.String(10), nullable=True, server_default='medium'))
    op.add_column('fb_live_engage_sessions', sa.Column('quantity_variation', sa.Boolean(), nullable=True, server_default='true'))
    op.add_column('fb_live_engage_sessions', sa.Column('code_pattern', sa.String(500), nullable=True))


def downgrade():
    op.drop_column('fb_live_engage_sessions', 'code_pattern')
    op.drop_column('fb_live_engage_sessions', 'quantity_variation')
    op.drop_column('fb_live_engage_sessions', 'aggressive_level')
