"""add credit_cost_per_post column to platforms

Revision ID: 010
Revises: 009
Create Date: 2026-03-01

Adds credit_cost_per_post field so admin can configure per-post credit costs.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE platforms ADD COLUMN IF NOT EXISTS "
        "credit_cost_per_post INTEGER DEFAULT 1"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE platforms DROP COLUMN IF EXISTS credit_cost_per_post")
