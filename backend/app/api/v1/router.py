from fastapi import APIRouter
from app.api.v1 import auth, jobs, credits, payments, admin, export, platforms, uploads, telegram, tenant_settings, sse, tenant_dashboard, fan_analysis, business_profile, trends, fb_ads

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["Scraping Jobs"])
api_router.include_router(credits.router, prefix="/credits", tags=["Credits"])
api_router.include_router(payments.router, prefix="/payments", tags=["Payments"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
api_router.include_router(export.router, prefix="/export", tags=["Export"])
api_router.include_router(platforms.router, prefix="/platforms", tags=["Platforms"])
api_router.include_router(uploads.router, prefix="/uploads", tags=["Uploads"])
api_router.include_router(telegram.router, prefix="/telegram", tags=["Telegram"])
api_router.include_router(tenant_settings.router, prefix="/tenant/settings", tags=["Tenant Settings"])
api_router.include_router(sse.router, prefix="/sse", tags=["SSE"])
api_router.include_router(tenant_dashboard.router, prefix="/tenant/dashboard", tags=["Tenant Dashboard"])
api_router.include_router(fan_analysis.router, prefix="/fan-analysis", tags=["Fan Analysis"])
api_router.include_router(business_profile.router, prefix="/business-profile", tags=["AI Business Profile"])
api_router.include_router(trends.router, prefix="/trends", tags=["Trends"])
api_router.include_router(fb_ads.router, prefix="/fb-ads", tags=["Facebook Ads"])
