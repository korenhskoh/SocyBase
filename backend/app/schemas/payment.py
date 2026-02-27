from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class StripeCheckoutRequest(BaseModel):
    package_id: UUID


class StripeCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class BankTransferRequest(BaseModel):
    package_id: UUID
    reference: str = Field(min_length=1, max_length=255)
    proof_url: str  # URL to uploaded proof image


class PaymentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    credit_package_id: UUID | None
    amount_cents: int
    currency: str
    method: str
    status: str
    stripe_subscription_id: str | None = None
    bank_transfer_reference: str | None
    bank_transfer_proof_url: str | None
    admin_notes: str | None
    completed_at: datetime | None
    refunded_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
