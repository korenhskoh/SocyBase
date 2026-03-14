"""create fb_action_batches table and add batch_id to fb_action_logs

Revision ID: 018
Revises: 017
Create Date: 2026-03-14

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = '018'
down_revision = '017'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fb_action_batches',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('total_rows', sa.Integer(), server_default='0'),
        sa.Column('completed_rows', sa.Integer(), server_default='0'),
        sa.Column('success_count', sa.Integer(), server_default='0'),
        sa.Column('failed_count', sa.Integer(), server_default='0'),
        sa.Column('execution_mode', sa.String(20), server_default='sequential'),
        sa.Column('delay_seconds', sa.Float(), server_default='5.0'),
        sa.Column('max_parallel', sa.Integer(), server_default='3'),
        sa.Column('csv_data_encrypted', sa.Text()),
        sa.Column('proxy_config', JSONB),
        sa.Column('error_message', sa.Text()),
        sa.Column('celery_task_id', sa.String(255)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(timezone=True)),
        sa.Column('completed_at', sa.DateTime(timezone=True)),
    )

    # Add batch_id FK to fb_action_logs
    op.add_column('fb_action_logs', sa.Column('batch_id', UUID(as_uuid=True), sa.ForeignKey('fb_action_batches.id'), nullable=True))
    op.create_index('ix_fb_action_logs_batch_id', 'fb_action_logs', ['batch_id'])


def downgrade():
    op.drop_index('ix_fb_action_logs_batch_id', table_name='fb_action_logs')
    op.drop_column('fb_action_logs', 'batch_id')
    op.drop_table('fb_action_batches')
