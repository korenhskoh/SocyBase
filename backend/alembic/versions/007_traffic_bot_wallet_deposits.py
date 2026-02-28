"""create traffic bot wallet deposits table

Revision ID: 007
Revises: 006
Create Date: 2026-02-28

Creates table for user-submitted bank transfer deposit requests
for Traffic Bot wallet top-ups.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL with IF NOT EXISTS because Base.metadata.create_all()
    # may have already created this table before migrations ran.
    op.execute("""
        CREATE TABLE IF NOT EXISTS traffic_bot_wallet_deposits (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id),
            amount NUMERIC(12,4) NOT NULL,
            status VARCHAR(30) DEFAULT 'pending',
            bank_reference VARCHAR(255) NOT NULL,
            proof_url VARCHAR(500),
            admin_notes TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            reviewed_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_traffic_bot_wallet_deposits_tenant_id ON traffic_bot_wallet_deposits(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_traffic_bot_wallet_deposits_created_at ON traffic_bot_wallet_deposits(created_at)")


def downgrade() -> None:
    op.drop_table("traffic_bot_wallet_deposits")
