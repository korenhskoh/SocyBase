from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from decimal import Decimal


class CreateJobRequest(BaseModel):
    platform: str = Field(default="facebook")
    job_type: str = Field(default="full_pipeline")
    input_type: str = Field(default="post_url")
    input_value: str = Field(min_length=1)
    scheduled_at: datetime | None = None
    settings: dict = Field(default_factory=dict)


class JobResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID
    platform_id: UUID
    job_type: str
    status: str
    input_type: str
    input_value: str
    input_metadata: dict
    scheduled_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    total_items: int
    processed_items: int
    failed_items: int
    progress_pct: Decimal
    credits_estimated: int
    credits_used: int
    result_file_url: str | None
    result_row_count: int
    error_message: str | None
    error_details: dict | None = None
    settings: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResumeJobRequest(BaseModel):
    """Resume a failed job from its last checkpoint."""
    profile_retry_count: int = Field(default=2, ge=0, le=3)


class JobProgressResponse(BaseModel):
    id: UUID
    status: str
    total_items: int
    processed_items: int
    failed_items: int
    progress_pct: Decimal
    credits_used: int


class EstimateRequest(BaseModel):
    platform: str = "facebook"
    input_type: str = "post_url"
    input_value: str


class EstimateResponse(BaseModel):
    estimated_comments: int
    estimated_profiles: int
    estimated_credits: int
    message: str


class ScrapedProfileResponse(BaseModel):
    id: UUID
    platform_user_id: str
    name: str | None
    first_name: str | None
    last_name: str | None
    gender: str | None
    birthday: str | None
    relationship: str | None = Field(default=None, validation_alias="relationship_status")
    education: str | None
    work: str | None
    position: str | None
    hometown: str | None
    location: str | None
    website: str | None
    languages: str | None
    username_link: str | None
    username: str | None
    about: str | None
    phone: str | None
    picture_url: str | None
    scrape_status: str
    scraped_at: datetime | None

    model_config = {"from_attributes": True}


class PageAuthorProfileResponse(BaseModel):
    id: UUID
    platform_object_id: str
    name: str | None = None
    about: str | None = None
    category: str | None = None
    description: str | None = None
    location: str | None = None
    phone: str | None = None
    website: str | None = None
    picture_url: str | None = None
    cover_url: str | None = None
    fetched_at: datetime | None = None

    model_config = {"from_attributes": True}
