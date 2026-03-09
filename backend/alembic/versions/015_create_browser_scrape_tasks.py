"""create browser_scrape_tasks table

Revision ID: 015
Revises: 014
Create Date: 2026-03-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'browser_scrape_tasks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('job_id', UUID(as_uuid=True), sa.ForeignKey('scraping_jobs.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('task_type', sa.String(30), nullable=False),
        sa.Column('target_url', sa.Text(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending', index=True),
        sa.Column('result_data', JSONB),
        sa.Column('error_message', sa.Text()),
        sa.Column('limit', sa.Integer()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_table('browser_scrape_tasks')
