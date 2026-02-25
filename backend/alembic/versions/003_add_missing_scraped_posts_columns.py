"""add missing columns to scraped_posts and credit_balances

Revision ID: 003
Revises: 002
Create Date: 2026-02-25

The ScrapedPost model was updated with new fields (updated_time, from_name,
from_id, comment_count, reaction_count, share_count, attachment_type,
attachment_url, post_url) but Base.metadata.create_all() only creates new
tables — it doesn't add columns to existing ones.

Also adds lifetime_used to credit_balances if missing.
"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # scraped_posts columns
    scraped_posts_columns = [
        ("updated_time", "TIMESTAMPTZ"),
        ("from_name", "VARCHAR(255)"),
        ("from_id", "VARCHAR(255)"),
        ("comment_count", "INTEGER DEFAULT 0"),
        ("reaction_count", "INTEGER DEFAULT 0"),
        ("share_count", "INTEGER DEFAULT 0"),
        ("attachment_type", "VARCHAR(50)"),
        ("attachment_url", "TEXT"),
        ("post_url", "TEXT"),
    ]
    for col_name, col_type in scraped_posts_columns:
        op.execute(
            f'ALTER TABLE scraped_posts ADD COLUMN IF NOT EXISTS "{col_name}" {col_type}'
        )

    # credit_balances columns
    op.execute(
        'ALTER TABLE credit_balances ADD COLUMN IF NOT EXISTS "lifetime_used" INTEGER DEFAULT 0'
    )


def downgrade() -> None:
    scraped_posts_columns = [
        "updated_time", "from_name", "from_id", "comment_count",
        "reaction_count", "share_count", "attachment_type",
        "attachment_url", "post_url",
    ]
    for col_name in scraped_posts_columns:
        op.execute(f'ALTER TABLE scraped_posts DROP COLUMN IF EXISTS "{col_name}"')

    op.execute('ALTER TABLE credit_balances DROP COLUMN IF EXISTS "lifetime_used"')
