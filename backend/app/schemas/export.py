from pydantic import BaseModel
from uuid import UUID


class ExportRequest(BaseModel):
    job_id: UUID
    format: str = "csv"  # csv, excel, json


class FacebookAdsExportRequest(BaseModel):
    job_id: UUID
