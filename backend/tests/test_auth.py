"""
Tests for the authentication endpoints: /api/v1/auth/*
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# POST /api/v1/auth/register
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    """A new user can register and receives JWT tokens."""
    payload = {
        "email": "newuser@example.com",
        "password": "StrongPass123",
        "full_name": "New User",
        "tenant_name": "New Org",
        "language": "en",
    }
    response = await client.post("/api/v1/auth/register", json=payload)

    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert isinstance(data["expires_in"], int)


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient, test_user):
    """Registering with an email that already exists returns 409 Conflict."""
    payload = {
        "email": "test@example.com",  # same as test_user fixture
        "password": "AnotherPass123",
        "full_name": "Duplicate User",
        "tenant_name": "Dup Org",
    }
    response = await client.post("/api/v1/auth/register", json=payload)

    assert response.status_code == 409
    data = response.json()
    assert "already" in data["detail"].lower()


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, test_user):
    """A registered user can log in with correct credentials."""
    payload = {
        "email": "test@example.com",
        "password": "TestPassword123",
    }
    response = await client.post("/api/v1/auth/login", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, test_user):
    """Login with an incorrect password returns 401 Unauthorized."""
    payload = {
        "email": "test@example.com",
        "password": "WrongPassword999",
    }
    response = await client.post("/api/v1/auth/login", json=payload)

    assert response.status_code == 401
    data = response.json()
    assert "invalid" in data["detail"].lower()


# ---------------------------------------------------------------------------
# GET /api/v1/auth/me
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_me_authenticated(client: AsyncClient, auth_headers: dict):
    """An authenticated user can retrieve their own profile."""
    response = await client.get("/api/v1/auth/me", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@example.com"
    assert data["full_name"] == "Test User"
    assert data["role"] == "tenant_admin"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient):
    """Accessing /me without a token returns 401 or 403."""
    response = await client.get("/api/v1/auth/me")

    # FastAPI's HTTPBearer returns 403 when no credentials are supplied.
    assert response.status_code in (401, 403)
