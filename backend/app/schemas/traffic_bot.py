from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


# ── Request schemas ─────────────────────────────────────────

class OrderCreateRequest(BaseModel):
    service_id: UUID
    link: str = Field(min_length=1, max_length=1000)
    quantity: int = Field(gt=0)


class ServiceUpdateRequest(BaseModel):
    fee_pct: float | None = Field(None, ge=0, le=500)
    is_enabled: bool | None = None
    sort_order: int | None = None


class BulkFeeUpdateRequest(BaseModel):
    category: str
    fee_pct: float = Field(ge=0, le=500)


class WalletDepositRequest(BaseModel):
    tenant_id: UUID
    amount: float = Field(gt=0)
    description: str = "Admin deposit"


# ── Response schemas ────────────────────────────────────────

class ServiceResponse(BaseModel):
    id: UUID
    external_service_id: int
    name: str
    category: str
    type: str
    rate: float
    min_quantity: int
    max_quantity: int
    fee_pct: float
    is_enabled: bool
    sort_order: int

    model_config = {"from_attributes": True}


class PriceCalcResponse(BaseModel):
    base_cost: float
    fee_amount: float
    total_cost: float


class OrderResponse(BaseModel):
    id: UUID
    service_id: UUID
    service_name: str | None = None
    external_order_id: int | None = None
    link: str
    quantity: int
    base_cost: float
    fee_amount: float
    total_cost: float
    status: str
    start_count: int | None = None
    remains: int | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrderListResponse(BaseModel):
    items: list[OrderResponse]
    total: int
    limit: int
    offset: int


class WalletResponse(BaseModel):
    balance: float
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class TransactionResponse(BaseModel):
    id: UUID
    type: str
    amount: float
    balance_after: float
    description: str | None = None
    reference_id: UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class APIBalanceResponse(BaseModel):
    balance: str
    currency: str


# ── Wallet Deposit schemas ─────────────────────────────────

class WalletDepositSubmitRequest(BaseModel):
    amount: float = Field(gt=0)
    bank_reference: str = Field(min_length=1, max_length=255)
    proof_url: str | None = None


class WalletDepositResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    amount: float
    status: str
    bank_reference: str
    proof_url: str | None = None
    admin_notes: str | None = None
    created_at: datetime
    reviewed_at: datetime | None = None

    model_config = {"from_attributes": True}


class WalletDepositApproveRequest(BaseModel):
    admin_notes: str | None = None
