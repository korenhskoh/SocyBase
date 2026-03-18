"""add scheduled_at to fb_warmup_batches

Revision ID: 026
Revises: 025
Create Date: 2026-03-18
"""
from alembic import op
import sqlalchemy as sa

revision = '026'
down_revision = '025'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fb_warmup_batches', sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('fb_warmup_batches', 'scheduled_at')
