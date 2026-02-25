import os
import logging
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.config import get_settings
from app.api.v1.router import api_router
from app.database import engine, Base, async_session
import app.models  # noqa: F401 — ensure all models are registered
from sqlalchemy import select

logger = logging.getLogger(__name__)
settings = get_settings()

# Rate limiter (uses client IP)
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

# Ensure directories exist before StaticFiles mount
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.export_dir, exist_ok=True)


async def _seed_initial_data():
    """Create super admin, platforms, and credit packages if they don't exist."""
    from app.models.user import User
    from app.models.tenant import Tenant
    from app.models.platform import Platform
    from app.models.credit import CreditBalance, CreditPackage
    from app.utils.security import hash_password

    async with async_session() as db:
        # Check if super admin already exists
        result = await db.execute(select(User).where(User.email == settings.super_admin_email))
        if result.scalar_one_or_none():
            return  # Already seeded

        logger.info("Seeding initial data (first run)...")

        # Platforms
        facebook = Platform(
            name="facebook", display_name="Facebook", is_enabled=True,
            config={"base_url": settings.akng_base_url, "api_version": settings.akng_api_version},
            credit_cost_per_profile=1, credit_cost_per_comment_page=1,
        )
        db.add(facebook)
        db.add(Platform(
            name="tiktok", display_name="TikTok", is_enabled=False, config={},
            credit_cost_per_profile=1, credit_cost_per_comment_page=1,
        ))

        # Credit packages
        for name, credits, price, bonus, order in [
            ("Starter", 100, 999, 0, 1),
            ("Growth", 500, 3999, 50, 2),
            ("Professional", 2000, 12999, 300, 3),
            ("Enterprise", 10000, 49999, 2000, 4),
        ]:
            db.add(CreditPackage(
                name=name, credits=credits, price_cents=price,
                currency="USD", bonus_credits=bonus, sort_order=order,
            ))

        # Super admin tenant + user
        admin_tenant = Tenant(name="SocyBase Admin", slug="socybase-admin", plan="enterprise")
        db.add(admin_tenant)
        await db.flush()

        admin_user = User(
            tenant_id=admin_tenant.id, email=settings.super_admin_email,
            password_hash=hash_password(settings.super_admin_password),
            full_name="Super Admin", role="super_admin",
            email_verified=True, language="en",
        )
        db.add(admin_user)
        db.add(CreditBalance(tenant_id=admin_tenant.id, balance=999999, lifetime_purchased=999999))

        await db.commit()
        logger.info("Initial data seeded: super admin, platforms, credit packages")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified")

    # Auto-seed on first run
    try:
        await _seed_initial_data()
    except Exception as e:
        logger.error("Failed to seed initial data: %s", e)

    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    description="Social Media Data Extraction SaaS Platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.app_debug else None,
    redoc_url="/redoc" if settings.app_debug else None,
)

# Attach rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Global unhandled exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        str(exc),
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api/v1")

# Serve uploaded files
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "app": settings.app_name}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)
