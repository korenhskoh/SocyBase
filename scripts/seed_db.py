"""
Database Seed Script
Run after migrations to populate initial data.

Usage: python -m scripts.seed_db
"""
import asyncio
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.database import async_session, engine, Base
from app.models.tenant import Tenant
from app.models.user import User
from app.models.credit import CreditBalance, CreditPackage
from app.models.platform import Platform
from app.utils.security import hash_password
from app.config import get_settings

settings = get_settings()


async def seed():
    async with async_session() as db:
        # Create platforms
        facebook = Platform(
            name="facebook",
            display_name="Facebook",
            is_enabled=True,
            config={
                "base_url": "https://api.akng.io.vn/graph",
                "api_version": "v19.0",
            },
            credit_cost_per_profile=1,
            credit_cost_per_comment_page=1,
        )
        db.add(facebook)

        tiktok = Platform(
            name="tiktok",
            display_name="TikTok",
            is_enabled=False,
            config={},
            credit_cost_per_profile=1,
            credit_cost_per_comment_page=1,
        )
        db.add(tiktok)

        # Create credit packages
        packages = [
            CreditPackage(
                name="Starter",
                credits=100,
                price_cents=999,
                currency="USD",
                bonus_credits=0,
                sort_order=1,
            ),
            CreditPackage(
                name="Growth",
                credits=500,
                price_cents=3999,
                currency="USD",
                bonus_credits=50,
                sort_order=2,
            ),
            CreditPackage(
                name="Professional",
                credits=2000,
                price_cents=12999,
                currency="USD",
                bonus_credits=300,
                sort_order=3,
            ),
            CreditPackage(
                name="Enterprise",
                credits=10000,
                price_cents=49999,
                currency="USD",
                bonus_credits=2000,
                sort_order=4,
            ),
        ]
        for pkg in packages:
            db.add(pkg)

        # Create super admin tenant
        admin_tenant = Tenant(
            name="SocyBase Admin",
            slug="socybase-admin",
            plan="enterprise",
        )
        db.add(admin_tenant)
        await db.flush()

        # Create super admin user
        admin_user = User(
            tenant_id=admin_tenant.id,
            email=settings.super_admin_email,
            password_hash=hash_password(settings.super_admin_password),
            full_name="Super Admin",
            role="super_admin",
            email_verified=True,
            language="en",
        )
        db.add(admin_user)

        # Create admin credit balance
        admin_balance = CreditBalance(
            tenant_id=admin_tenant.id,
            balance=999999,
            lifetime_purchased=999999,
        )
        db.add(admin_balance)

        await db.commit()
        print("Database seeded successfully!")
        print(f"  Super Admin: {settings.super_admin_email}")
        print(f"  Platforms: Facebook (enabled), TikTok (disabled)")
        print(f"  Credit Packages: Starter, Growth, Professional, Enterprise")


if __name__ == "__main__":
    asyncio.run(seed())
