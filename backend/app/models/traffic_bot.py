import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Text, Numeric, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class TrafficBotWallet(Base):
    __tablename__ = "traffic_bot_wallets"
    __table_args__ = (
        CheckConstraint("balance >= 0", name="ck_tb_wallet_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        unique=True, nullable=False,
    )
    balance: Mapped[float] = mapped_column(Numeric(12, 4), default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    tenant = relationship("Tenant")


class TrafficBotTransaction(Base):
    __tablename__ = "traffic_bot_transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    type: Mapped[str] = mapped_column(String(30), nullable=False)  # deposit, order_payment, refund
    amount: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    balance_after: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    tenant = relationship("Tenant")


class TrafficBotService(Base):
    __tablename__ = "traffic_bot_services"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    external_service_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(50), default="Default")
    rate: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False)  # API price per 1000
    min_quantity: Mapped[int] = mapped_column(Integer, default=10)
    max_quantity: Mapped[int] = mapped_column(Integer, default=1000000)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    fee_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=30)  # markup percentage
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    orders = relationship("TrafficBotOrder", back_populates="service")


class TrafficBotOrder(Base):
    __tablename__ = "traffic_bot_orders"
    __table_args__ = (
        Index("ix_tb_orders_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False,
    )
    service_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("traffic_bot_services.id"), nullable=False,
    )
    external_order_id: Mapped[int | None] = mapped_column(Integer, index=True)
    link: Mapped[str] = mapped_column(String(1000), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    base_cost: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    fee_amount: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    total_cost: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False)
    status: Mapped[str] = mapped_column(
        String(30), default="pending"
    )  # pending, processing, in_progress, completed, partial, cancelled, refunded
    start_count: Mapped[int | None] = mapped_column(Integer)
    remains: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    tenant = relationship("Tenant")
    user = relationship("User")
    service = relationship("TrafficBotService", back_populates="orders")
