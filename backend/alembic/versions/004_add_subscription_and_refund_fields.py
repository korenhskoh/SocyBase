"""add subscription billing_interval and refund fields

Revision ID: 004
Revises: 003
Create Date: 2026-02-25

Adds:
- credit_packages.billing_interval (one_time, monthly, annual)
- payments.stripe_subscription_id
- payments.refunded_at
"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE credit_packages ADD COLUMN IF NOT EXISTS "
        "billing_interval VARCHAR(20) DEFAULT 'one_time'"
    )
    op.execute(
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS "
        "stripe_subscription_id VARCHAR(255)"
    )
    op.execute(
        "ALTER TABLE payments ADD COLUMN IF NOT EXISTS "
        "refunded_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute('ALTER TABLE credit_packages DROP COLUMN IF EXISTS "billing_interval"')
    op.execute('ALTER TABLE payments DROP COLUMN IF EXISTS "stripe_subscription_id"')
    op.execute('ALTER TABLE payments DROP COLUMN IF EXISTS "refunded_at"')
