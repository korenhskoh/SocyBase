"""create quick_scan_history table

Revision ID: 022
Revises: 021
Create Date: 2026-03-15

Persists quick-scan results so users can retrieve previous scans.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "quick_scan_history",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "competitor_id",
            UUID(as_uuid=True),
            sa.ForeignKey("competitor_pages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("page_id", sa.String(255), nullable=False),
        sa.Column("page_name", sa.String(255), default=""),
        sa.Column("posts", JSONB, nullable=False),
        sa.Column("posts_count", sa.Integer, default=0),
        sa.Column("credits_used", sa.Integer, default=0),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("quick_scan_history")
