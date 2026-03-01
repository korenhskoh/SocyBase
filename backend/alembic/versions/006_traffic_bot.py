"""create traffic bot tables

Revision ID: 006
Revises: 005
Create Date: 2026-02-28

Creates tables for Traffic Bot feature:
- traffic_bot_wallets: per-tenant wallet balance
- traffic_bot_transactions: immutable wallet ledger
- traffic_bot_services: cached service catalog from BulkProviders API
- traffic_bot_orders: order records
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    """Check if a table already exists in the database."""
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if not _table_exists("traffic_bot_wallets"):
        op.create_table(
            "traffic_bot_wallets",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("balance", sa.Numeric(12, 4), server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.CheckConstraint("balance >= 0", name="ck_tb_wallet_non_negative"),
        )

    if not _table_exists("traffic_bot_transactions"):
        op.create_table(
            "traffic_bot_transactions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("type", sa.String(30), nullable=False),
            sa.Column("amount", sa.Numeric(12, 4), nullable=False),
            sa.Column("balance_after", sa.Numeric(12, 4), nullable=False),
            sa.Column("description", sa.Text),
            sa.Column("reference_id", postgresql.UUID(as_uuid=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        )

    if not _table_exists("traffic_bot_services"):
        op.create_table(
            "traffic_bot_services",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("external_service_id", sa.Integer, nullable=False, unique=True),
            sa.Column("name", sa.String(500), nullable=False),
            sa.Column("category", sa.String(100), nullable=False),
            sa.Column("type", sa.String(50), server_default="Default"),
            sa.Column("rate", sa.Numeric(12, 6), nullable=False),
            sa.Column("min_quantity", sa.Integer, server_default="10"),
            sa.Column("max_quantity", sa.Integer, server_default="1000000"),
            sa.Column("is_enabled", sa.Boolean, server_default="true"),
            sa.Column("fee_pct", sa.Numeric(5, 2), server_default="30"),
            sa.Column("sort_order", sa.Integer, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if not _table_exists("traffic_bot_orders"):
        op.create_table(
            "traffic_bot_orders",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("traffic_bot_services.id"), nullable=False),
            sa.Column("external_order_id", sa.Integer, index=True),
            sa.Column("link", sa.String(1000), nullable=False),
            sa.Column("quantity", sa.Integer, nullable=False),
            sa.Column("base_cost", sa.Numeric(12, 4), nullable=False),
            sa.Column("fee_amount", sa.Numeric(12, 4), nullable=False),
            sa.Column("total_cost", sa.Numeric(12, 4), nullable=False),
            sa.Column("status", sa.String(30), server_default="pending"),
            sa.Column("start_count", sa.Integer),
            sa.Column("remains", sa.Integer),
            sa.Column("error_message", sa.Text),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_tb_orders_tenant_status", "traffic_bot_orders", ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_tb_orders_tenant_status", table_name="traffic_bot_orders")
    op.drop_table("traffic_bot_orders")
    op.drop_table("traffic_bot_services")
    op.drop_table("traffic_bot_transactions")
    op.drop_table("traffic_bot_wallets")
