from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from uuid import UUID
from app.database import get_db
from app.models.platform import Platform

router = APIRouter()


class PlatformResponse(BaseModel):
    id: UUID
    name: str
    display_name: str
    is_enabled: bool
    credit_cost_per_profile: int
    credit_cost_per_comment_page: int

    model_config = {"from_attributes": True}


@router.get("", response_model=list[PlatformResponse])
async def list_platforms(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Platform).where(Platform.is_enabled == True).order_by(Platform.name)
    )
    return result.scalars().all()
