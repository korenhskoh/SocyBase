"""create fb_login_batches and fb_login_results tables

Revision ID: 019
Revises: 018
Create Date: 2026-03-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '019'
down_revision = '018'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fb_login_batches',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('total_rows', sa.Integer(), server_default='0'),
        sa.Column('completed_rows', sa.Integer(), server_default='0'),
        sa.Column('success_count', sa.Integer(), server_default='0'),
        sa.Column('failed_count', sa.Integer(), server_default='0'),
        sa.Column('execution_mode', sa.String(20), server_default='sequential'),
        sa.Column('delay_seconds', sa.Float(), server_default='10.0'),
        sa.Column('max_parallel', sa.Integer(), server_default='2'),
        sa.Column('csv_data_encrypted', sa.Text()),
        sa.Column('proxy_pool', JSONB),
        sa.Column('error_message', sa.Text()),
        sa.Column('celery_task_id', sa.String(255)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(timezone=True)),
        sa.Column('completed_at', sa.DateTime(timezone=True)),
    )

    op.create_table(
        'fb_login_results',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('login_batch_id', UUID(as_uuid=True), sa.ForeignKey('fb_login_batches.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('fb_user_id', sa.String(50)),
        sa.Column('cookie_encrypted', sa.Text()),
        sa.Column('user_agent', sa.String(500)),
        sa.Column('proxy_used', JSONB),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('error_message', sa.Text()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('fb_login_results')
    op.drop_table('fb_login_batches')
