from pydantic import BaseModel, Field
from typing import List


class BusinessProfileSettings(BaseModel):
    business_name: str = ""
    business_type: str = ""
    industry: str = ""
    country: str = ""
    facebook_page_url: str = ""
    product_service_links: List[str] = Field(default_factory=list)
    target_audience_description: str = ""


class EmailSettingsRequest(BaseModel):
    smtp_host: str = Field(max_length=255)
    smtp_port: int = Field(ge=1, le=65535)
    smtp_user: str = Field(max_length=255)
    smtp_password: str = Field(max_length=255)
    email_from: str = Field(max_length=255)


class EmailSettingsResponse(BaseModel):
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    email_from: str


class TenantSettingsResponse(BaseModel):
    email: EmailSettingsResponse | None = None
    business: BusinessProfileSettings | None = None
    ai_suggestions: dict | None = None


class UpdateTenantSettingsRequest(BaseModel):
    email: EmailSettingsRequest | None = None
    business: BusinessProfileSettings | None = None
    ai_suggestions: dict | None = None
