"""add missing columns to scraped_profiles

Revision ID: 002
Revises: 001
Create Date: 2026-02-25

The ScrapedProfile model was updated with new fields (phone, picture_url,
birthday, relationship, website, languages) but Base.metadata.create_all()
only creates new tables — it doesn't add columns to existing ones.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL with IF NOT EXISTS to safely add columns that may or may not exist
    columns = [
        ("birthday", "VARCHAR(100)"),
        ("relationship", "VARCHAR(255)"),
        ("website", "TEXT"),
        ("languages", "TEXT"),
        ("phone", "VARCHAR(100)"),
        ("picture_url", "TEXT"),
    ]
    for col_name, col_type in columns:
        op.execute(
            f'ALTER TABLE scraped_profiles ADD COLUMN IF NOT EXISTS "{col_name}" {col_type}'
        )


def downgrade() -> None:
    columns = ["birthday", "relationship", "website", "languages", "phone", "picture_url"]
    for col_name in columns:
        op.execute(f'ALTER TABLE scraped_profiles DROP COLUMN IF EXISTS "{col_name}"')
