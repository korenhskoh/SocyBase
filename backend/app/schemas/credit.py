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
    billing_interval: str = "one_time"
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
    billing_interval: str = "one_time"
    bonus_credits: int
    is_active: bool
    sort_order: int
    max_concurrent_jobs: int = 3
    daily_job_limit: int = 0
    monthly_credit_limit: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateCreditPackageRequest(BaseModel):
    name: str
    credits: int = Field(gt=0)
    price_cents: int = Field(ge=0)
    currency: str = "USD"
    stripe_price_id: str | None = None
    billing_interval: str = "one_time"  # one_time, monthly, annual
    bonus_credits: int = Field(ge=0, default=0)
    is_active: bool = True
    sort_order: int = 0
    max_concurrent_jobs: int = Field(3, ge=1, le=50)
    daily_job_limit: int = Field(0, ge=0)       # 0 = unlimited
    monthly_credit_limit: int = Field(0, ge=0)  # 0 = unlimited


class UpdateCreditPackageRequest(BaseModel):
    name: str | None = None
    credits: int | None = Field(None, gt=0)
    price_cents: int | None = Field(None, ge=0)
    currency: str | None = None
    stripe_price_id: str | None = None
    billing_interval: str | None = None
    bonus_credits: int | None = Field(None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = None
    max_concurrent_jobs: int | None = Field(None, ge=1, le=50)
    daily_job_limit: int | None = Field(None, ge=0)
    monthly_credit_limit: int | None = Field(None, ge=0)
