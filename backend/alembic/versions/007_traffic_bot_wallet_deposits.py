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
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    if "traffic_bot_wallet_deposits" not in inspector.get_table_names():
        op.create_table(
            "traffic_bot_wallet_deposits",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("amount", sa.Numeric(12, 4), nullable=False),
            sa.Column("status", sa.String(30), server_default="pending"),
            sa.Column("bank_reference", sa.String(255), nullable=False),
            sa.Column("proof_url", sa.String(500)),
            sa.Column("admin_notes", sa.Text),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        )


def downgrade() -> None:
    op.drop_table("traffic_bot_wallet_deposits")
