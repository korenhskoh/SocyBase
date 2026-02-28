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

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL with IF NOT EXISTS because Base.metadata.create_all()
    # may have already created these tables before migrations ran.
    op.execute("""
        CREATE TABLE IF NOT EXISTS traffic_bot_wallets (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
            balance NUMERIC(12,4) DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT ck_tb_wallet_non_negative CHECK (balance >= 0)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS traffic_bot_transactions (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            type VARCHAR(30) NOT NULL,
            amount NUMERIC(12,4) NOT NULL,
            balance_after NUMERIC(12,4) NOT NULL,
            description TEXT,
            reference_id UUID,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_traffic_bot_transactions_tenant_id ON traffic_bot_transactions(tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_traffic_bot_transactions_created_at ON traffic_bot_transactions(created_at)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS traffic_bot_services (
            id UUID PRIMARY KEY,
            external_service_id INTEGER NOT NULL UNIQUE,
            name VARCHAR(500) NOT NULL,
            category VARCHAR(100) NOT NULL,
            type VARCHAR(50) DEFAULT 'Default',
            rate NUMERIC(12,6) NOT NULL,
            min_quantity INTEGER DEFAULT 10,
            max_quantity INTEGER DEFAULT 1000000,
            is_enabled BOOLEAN DEFAULT true,
            fee_pct NUMERIC(5,2) DEFAULT 30,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS traffic_bot_orders (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id),
            service_id UUID NOT NULL REFERENCES traffic_bot_services(id),
            external_order_id INTEGER,
            link VARCHAR(1000) NOT NULL,
            quantity INTEGER NOT NULL,
            base_cost NUMERIC(12,4) NOT NULL,
            fee_amount NUMERIC(12,4) NOT NULL,
            total_cost NUMERIC(12,4) NOT NULL,
            status VARCHAR(30) DEFAULT 'pending',
            start_count INTEGER,
            remains INTEGER,
            error_message TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_traffic_bot_orders_external_order_id ON traffic_bot_orders(external_order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_traffic_bot_orders_created_at ON traffic_bot_orders(created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tb_orders_tenant_status ON traffic_bot_orders(tenant_id, status)")


def downgrade() -> None:
    op.drop_index("ix_tb_orders_tenant_status", table_name="traffic_bot_orders")
    op.drop_table("traffic_bot_orders")
    op.drop_table("traffic_bot_services")
    op.drop_table("traffic_bot_transactions")
    op.drop_table("traffic_bot_wallets")
