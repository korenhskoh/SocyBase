"""add composite indexes for performance at scale

Revision ID: 004
Revises: 003
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
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # scraping_jobs: used by dashboard counts, concurrent job checks, job listing
    op.create_index(
        "ix_scraping_jobs_tenant_status",
        "scraping_jobs",
        ["tenant_id", "status"],
    )
    # scraping_jobs: used by scheduled job dispatcher (check_scheduled_jobs)
    op.create_index(
        "ix_scraping_jobs_status_scheduled",
        "scraping_jobs",
        ["status", "scheduled_at"],
    )
    # scraping_jobs: used by job listing with ordering
    op.create_index(
        "ix_scraping_jobs_tenant_created",
        "scraping_jobs",
        ["tenant_id", "created_at"],
    )

    # scraped_profiles: used by result counting (WHERE job_id=? AND scrape_status='success')
    op.create_index(
        "ix_scraped_profiles_job_status",
        "scraped_profiles",
        ["job_id", "scrape_status"],
    )
    # scraped_profiles: used during enrichment to find profile by job + platform user
    op.create_index(
        "ix_scraped_profiles_job_user",
        "scraped_profiles",
        ["job_id", "platform_user_id"],
        unique=True,
    )

    # scraped_posts: used for post listing per job
    op.create_index(
        "ix_scraped_posts_job_tenant",
        "scraped_posts",
        ["job_id", "tenant_id"],
    )
    # scraped_posts: tenant-wide post queries sorted by time
    op.create_index(
        "ix_scraped_posts_tenant_created",
        "scraped_posts",
        ["tenant_id", "created_at"],
    )

    # extracted_comments: used during deduplication (group by commenter_user_id)
    op.create_index(
        "ix_extracted_comments_job_commenter",
        "extracted_comments",
        ["job_id", "commenter_user_id"],
    )

    # credit_transactions: tenant transaction history sorted by date
    op.create_index(
        "ix_credit_transactions_tenant_created",
        "credit_transactions",
        ["tenant_id", "created_at"],
    )


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
