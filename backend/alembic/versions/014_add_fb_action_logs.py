"""add fb_action_logs table and user_agent to fb_cookie_sessions

Revision ID: 014
Revises: 013
Create Date: 2026-03-14

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fb_action_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('action_name', sa.String(50), nullable=False),
        sa.Column('action_params', JSONB, server_default='{}'),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('response_data', JSONB),
        sa.Column('error_message', sa.Text()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Add user_agent column to fb_cookie_sessions
    op.add_column('fb_cookie_sessions', sa.Column('user_agent', sa.String(500), nullable=True))


def downgrade():
    op.drop_column('fb_cookie_sessions', 'user_agent')
    op.drop_table('fb_action_logs')
