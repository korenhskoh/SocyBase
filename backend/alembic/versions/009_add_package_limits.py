"""add scraping limit columns to credit_packages

Revision ID: 009
Revises: 008
Create Date: 2026-03-01

Adds per-package scraping limits so each business tier can define its own
max_concurrent_jobs, daily_job_limit, and monthly_credit_limit.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS "
        "max_concurrent_jobs INTEGER DEFAULT 3"
    )
    op.execute(
        "ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS "
        "daily_job_limit INTEGER DEFAULT 0"
    )
    op.execute(
        "ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS "
        "monthly_credit_limit INTEGER DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE credit_packages DROP COLUMN IF EXISTS max_concurrent_jobs")
    op.execute("ALTER TABLE credit_packages DROP COLUMN IF EXISTS daily_job_limit")
    op.execute("ALTER TABLE credit_packages DROP COLUMN IF EXISTS monthly_credit_limit")
