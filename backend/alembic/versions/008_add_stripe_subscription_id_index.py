"""add index on payments.stripe_subscription_id

Revision ID: 008
Revises: 007
Create Date: 2026-03-01
"""
from typing import Sequence, Union
from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_payments_stripe_subscription_id",
        "payments",
        ["stripe_subscription_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_payments_stripe_subscription_id", table_name="payments")
