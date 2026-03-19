"""add direct_accounts_encrypted to fb_live_engage_sessions, make login_batch_id nullable

Revision ID: 030
Revises: 029
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fb_live_engage_sessions', sa.Column('direct_accounts_encrypted', sa.Text(), nullable=True))
    op.alter_column('fb_live_engage_sessions', 'login_batch_id', existing_type=UUID(as_uuid=True), nullable=True)


def downgrade():
    op.alter_column('fb_live_engage_sessions', 'login_batch_id', existing_type=UUID(as_uuid=True), nullable=False)
    op.drop_column('fb_live_engage_sessions', 'direct_accounts_encrypted')
