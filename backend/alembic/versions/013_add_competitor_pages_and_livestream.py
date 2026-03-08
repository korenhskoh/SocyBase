"""add competitor_pages table and livestream fields to scraped_posts

Revision ID: 013
Revises: 012
Create Date: 2026-03-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade():
    # Create competitor_pages table
    op.create_table(
        'competitor_pages',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('page_id', sa.String(255), nullable=False),
        sa.Column('name', sa.String(500)),
        sa.Column('category', sa.String(255)),
        sa.Column('about', sa.Text()),
        sa.Column('location', sa.String(500)),
        sa.Column('picture_url', sa.Text()),
        sa.Column('page_url', sa.Text()),
        sa.Column('verification_status', sa.String(50)),
        sa.Column('source', sa.String(20), server_default='manual'),
        sa.Column('last_job_id', UUID(as_uuid=True), sa.ForeignKey('scraping_jobs.id', ondelete='SET NULL')),
        sa.Column('last_scanned_at', sa.DateTime(timezone=True)),
        sa.Column('total_posts_scanned', sa.Integer(), server_default='0'),
        sa.Column('avg_engagement', sa.Integer(), server_default='0'),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('raw_data', JSONB()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'page_id', name='uq_competitor_tenant_page'),
    )

    # Add livestream/video columns to scraped_posts
    op.add_column('scraped_posts', sa.Column('is_livestream', sa.Boolean(), server_default='false'))
    op.add_column('scraped_posts', sa.Column('video_views', sa.Integer()))
    op.add_column('scraped_posts', sa.Column('live_views', sa.Integer()))
    op.add_column('scraped_posts', sa.Column('video_length', sa.Float()))


def downgrade():
    op.drop_column('scraped_posts', 'video_length')
    op.drop_column('scraped_posts', 'live_views')
    op.drop_column('scraped_posts', 'video_views')
    op.drop_column('scraped_posts', 'is_livestream')
    op.drop_table('competitor_pages')
