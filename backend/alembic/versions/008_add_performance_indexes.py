"""add composite indexes for performance at scale

Revision ID: 008
Revises: 007
Create Date: 2026-02-28

Adds composite indexes for the most common query patterns:
- scraping_jobs: (tenant_id, status) for concurrent job counting and dashboard
- scraping_jobs: (status, scheduled_at) for scheduled job dispatcher
- scraped_profiles: (job_id, scrape_status) for result counting and enrichment
- scraped_profiles: (job_id, platform_user_id) for profile lookup during enrichment
- scraped_posts: (job_id, tenant_id) for post listing by job
- scraped_posts: (tenant_id, created_at) for tenant-wide post queries
- extracted_comments: (job_id, commenter_user_id) for user deduplication
- credit_transactions: (tenant_id, created_at) for transaction history
"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL with IF NOT EXISTS for idempotent migrations.
    # scraping_jobs: dashboard counts, concurrent job checks, job listing
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraping_jobs_tenant_status ON scraping_jobs(tenant_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraping_jobs_status_scheduled ON scraping_jobs(status, scheduled_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraping_jobs_tenant_created ON scraping_jobs(tenant_id, created_at)")

    # scraped_profiles: result counting, enrichment lookup
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraped_profiles_job_status ON scraped_profiles(job_id, scrape_status)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_scraped_profiles_job_user ON scraped_profiles(job_id, platform_user_id)")

    # scraped_posts: post listing per job, tenant-wide queries
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraped_posts_job_tenant ON scraped_posts(job_id, tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_scraped_posts_tenant_created ON scraped_posts(tenant_id, created_at)")

    # extracted_comments: deduplication by commenter
    op.execute("CREATE INDEX IF NOT EXISTS ix_extracted_comments_job_commenter ON extracted_comments(job_id, commenter_user_id)")

    # credit_transactions: tenant transaction history
    op.execute("CREATE INDEX IF NOT EXISTS ix_credit_transactions_tenant_created ON credit_transactions(tenant_id, created_at)")


def downgrade() -> None:
    op.drop_index("ix_credit_transactions_tenant_created", table_name="credit_transactions")
    op.drop_index("ix_extracted_comments_job_commenter", table_name="extracted_comments")
    op.drop_index("ix_scraped_posts_tenant_created", table_name="scraped_posts")
    op.drop_index("ix_scraped_posts_job_tenant", table_name="scraped_posts")
    op.drop_index("ix_scraped_profiles_job_user", table_name="scraped_profiles")
    op.drop_index("ix_scraped_profiles_job_status", table_name="scraped_profiles")
    op.drop_index("ix_scraping_jobs_tenant_created", table_name="scraping_jobs")
    op.drop_index("ix_scraping_jobs_status_scheduled", table_name="scraping_jobs")
    op.drop_index("ix_scraping_jobs_tenant_status", table_name="scraping_jobs")
