from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class AdminDashboardResponse(BaseModel):
    total_users: int
    total_tenants: int
    total_jobs: int
    total_credits_sold: int
    total_revenue_cents: int
    active_jobs: int
    jobs_today: int


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None


class UpdateTenantRequest(BaseModel):
    plan: str | None = None
    is_active: bool | None = None
    settings: dict | None = None


class GrantCreditsRequest(BaseModel):
    tenant_id: UUID
    amount: int = Field(gt=0)
    description: str = "Admin credit grant"


class ApprovePaymentRequest(BaseModel):
    admin_notes: str | None = None


class AuditLogResponse(BaseModel):
    id: UUID
    user_id: UUID | None
    tenant_id: UUID | None
    action: str
    resource_type: str | None
    resource_id: UUID | None
    details: dict
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
