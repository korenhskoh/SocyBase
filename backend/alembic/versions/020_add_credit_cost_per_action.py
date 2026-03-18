"""add credit_cost_per_action column to platforms

Revision ID: 020
Revises: 019
Create Date: 2026-03-15

Adds credit_cost_per_action field so admin can configure per-action credit costs
for FB Action Blaster batch execution. Default: 3 credits per action.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE platforms ADD COLUMN IF NOT EXISTS "
        "credit_cost_per_action INTEGER DEFAULT 3"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE platforms DROP COLUMN IF EXISTS credit_cost_per_action")
