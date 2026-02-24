from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class CreditBalanceResponse(BaseModel):
    balance: int
    lifetime_purchased: int
    lifetime_used: int

    model_config = {"from_attributes": True}


class CreditTransactionResponse(BaseModel):
    id: UUID
    type: str
    amount: int
    balance_after: int
    description: str | None
    reference_type: str | None
    reference_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreditPackageResponse(BaseModel):
    id: UUID
    name: str
    credits: int
    price_cents: int
    currency: str
    bonus_credits: int
    sort_order: int

    model_config = {"from_attributes": True}


class AdminCreditPackageResponse(BaseModel):
    id: UUID
    name: str
    credits: int
    price_cents: int
    currency: str
    stripe_price_id: str | None
    bonus_credits: int
    is_active: bool
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateCreditPackageRequest(BaseModel):
    name: str
    credits: int = Field(gt=0)
    price_cents: int = Field(ge=0)
    currency: str = "USD"
    stripe_price_id: str | None = None
    bonus_credits: int = Field(ge=0, default=0)
    is_active: bool = True
    sort_order: int = 0


class UpdateCreditPackageRequest(BaseModel):
    name: str | None = None
    credits: int | None = Field(None, gt=0)
    price_cents: int | None = Field(None, ge=0)
    currency: str | None = None
    stripe_price_id: str | None = None
    bonus_credits: int | None = Field(None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = None
