"""create page_author_profiles table

Revision ID: 001
Revises: None
Create Date: 2026-02-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_author_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("scraping_jobs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform_object_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("about", sa.Text),
        sa.Column("category", sa.String(255)),
        sa.Column("description", sa.Text),
        sa.Column("location", sa.String(500)),
        sa.Column("phone", sa.String(100)),
        sa.Column("website", sa.Text),
        sa.Column("picture_url", sa.Text),
        sa.Column("cover_url", sa.Text),
        sa.Column("raw_data", JSONB),
        sa.Column("fetched_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("page_author_profiles")
