"""
Tests for the credit endpoints: /api/v1/credits/*
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit import CreditPackage, CreditTransaction


# ---------------------------------------------------------------------------
# GET /api/v1/credits/balance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_balance(client: AsyncClient, auth_headers: dict):
    """An authenticated user can retrieve their tenant's credit balance."""
    response = await client.get("/api/v1/credits/balance", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["balance"] == 100
    assert data["lifetime_purchased"] == 100
    assert data["lifetime_used"] == 0


# ---------------------------------------------------------------------------
# GET /api/v1/credits/history
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_history_empty(client: AsyncClient, auth_headers: dict):
    """History returns an empty list when no transactions exist."""
    response = await client.get("/api/v1/credits/history", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 0


@pytest.mark.asyncio
async def test_get_history_with_transactions(
    client: AsyncClient,
    auth_headers: dict,
    test_user,
    db_session: AsyncSession,
):
    """History returns transactions belonging to the authenticated tenant."""
    # Seed two transactions for the test tenant
    tx1 = CreditTransaction(
        id=uuid.uuid4(),
        tenant_id=test_user.tenant_id,
        user_id=test_user.id,
        type="purchase",
        amount=50,
        balance_after=150,
        description="Bought 50 credits",
    )
    tx2 = CreditTransaction(
        id=uuid.uuid4(),
        tenant_id=test_user.tenant_id,
        user_id=test_user.id,
        type="usage",
        amount=-10,
        balance_after=140,
        description="Scraping job",
    )
    db_session.add_all([tx1, tx2])
    await db_session.flush()

    response = await client.get("/api/v1/credits/history", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2

    # Verify that each transaction has the expected fields
    for tx in data:
        assert "id" in tx
        assert "type" in tx
        assert "amount" in tx
        assert "balance_after" in tx
        assert "created_at" in tx


# ---------------------------------------------------------------------------
# GET /api/v1/credits/packages
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_packages_empty(client: AsyncClient, auth_headers: dict):
    """Packages endpoint returns an empty list when no active packages exist."""
    response = await client.get("/api/v1/credits/packages", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_get_packages_returns_active_only(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
):
    """Only active packages are returned; inactive ones are excluded."""
    active_pkg = CreditPackage(
        id=uuid.uuid4(),
        name="Starter Pack",
        credits=100,
        price_cents=999,
        currency="USD",
        bonus_credits=10,
        is_active=True,
        sort_order=1,
    )
    inactive_pkg = CreditPackage(
        id=uuid.uuid4(),
        name="Deprecated Pack",
        credits=50,
        price_cents=499,
        currency="USD",
        bonus_credits=0,
        is_active=False,
        sort_order=2,
    )
    db_session.add_all([active_pkg, inactive_pkg])
    await db_session.flush()

    response = await client.get("/api/v1/credits/packages", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1

    # The active package must be present; the inactive one must not be.
    names = [pkg["name"] for pkg in data]
    assert "Starter Pack" in names
    assert "Deprecated Pack" not in names

    # Verify shape of a returned package object
    pkg = next(p for p in data if p["name"] == "Starter Pack")
    assert pkg["credits"] == 100
    assert pkg["price_cents"] == 999
    assert pkg["currency"] == "USD"
    assert pkg["bonus_credits"] == 10
