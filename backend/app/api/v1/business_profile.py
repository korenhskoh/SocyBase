"""Business profile API — AI-powered competitor page suggestions."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter()


@router.post("/suggest-pages")
async def suggest_competitor_pages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Use OpenAI to suggest competitor Facebook pages based on business profile."""
    settings = get_settings()
    api_key = settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured. Set OPENAI_API_KEY.")

    result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    business_data = (tenant.settings or {}).get("business", {})
    if not business_data or not business_data.get("business_name"):
        raise HTTPException(
            status_code=400,
            detail="Business profile not configured. Go to Settings to fill in your business details.",
        )

    from app.services.openai_service import OpenAIService
    openai_svc = OpenAIService(api_key=api_key)

    suggestions = await openai_svc.suggest_competitor_pages(business_data)
    return suggestions
