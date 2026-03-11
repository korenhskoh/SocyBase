"""create live_sessions and live_comments tables

Revision ID: 016
Revises: 015
Create Date: 2026-03-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = '016'
down_revision = '015'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'live_sessions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('fb_page_id', UUID(as_uuid=True), sa.ForeignKey('fb_pages.id', ondelete='CASCADE'), nullable=False),
        sa.Column('video_id', sa.String(100), nullable=False),
        sa.Column('title', sa.String(500)),
        sa.Column('status', sa.String(20), nullable=False, server_default='monitoring'),
        sa.Column('celery_task_id', sa.String(200)),
        sa.Column('total_comments', sa.Integer, server_default='0'),
        sa.Column('total_orders', sa.Integer, server_default='0'),
        sa.Column('settings', JSONB),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('ended_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_live_sessions_tenant_status', 'live_sessions', ['tenant_id', 'status'])

    op.create_table(
        'live_comments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('live_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('fb_comment_id', sa.String(200), unique=True, nullable=False),
        sa.Column('commenter_id', sa.String(100), nullable=False),
        sa.Column('commenter_name', sa.String(300), nullable=False),
        sa.Column('message', sa.Text, nullable=False),
        sa.Column('is_order', sa.Boolean, server_default='false'),
        sa.Column('matched_keywords', JSONB),
        sa.Column('replied', sa.Boolean, server_default='false'),
        sa.Column('reply_message', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_live_comments_session_created', 'live_comments', ['session_id', 'created_at'])
    op.create_index('ix_live_comments_session_order', 'live_comments', ['session_id', 'is_order'])


def downgrade():
    op.drop_table('live_comments')
    op.drop_table('live_sessions')
