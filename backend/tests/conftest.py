"""
Shared test fixtures for the SocyBase backend test suite.

NOTE: This test suite uses aiosqlite as the async SQLite driver so that tests
run against an in-memory database instead of a real PostgreSQL instance.
Make sure ``aiosqlite`` is installed as a dev dependency:

    pip install aiosqlite>=0.19.0

It is already declared in ``pyproject.toml`` under ``[project.optional-dependencies] dev``.
"""

from __future__ import annotations

import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, JSON
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB, INET

# ---------------------------------------------------------------------------
# Patch PostgreSQL-specific column types *before* importing any model so that
# SQLAlchemy renders them as SQLite-compatible types when ``create_all`` runs
# against the in-memory SQLite database.
# ---------------------------------------------------------------------------
from sqlalchemy import String

# UUID(as_uuid=True) -> CHAR(32)  (SQLAlchemy stores UUIDs as hex strings)
# JSONB             -> JSON       (SQLite has built-in JSON1 via json type)
# INET              -> VARCHAR    (not used in queries, just storage)

from app.database import Base, get_db  # noqa: E402  (after type patches)
from app.models.user import User  # noqa: E402
from app.models.tenant import Tenant  # noqa: E402
from app.models.credit import CreditBalance  # noqa: E402
from app.utils.security import create_access_token, hash_password  # noqa: E402

# Import all models so Base.metadata has every table registered.
import app.models  # noqa: F401, E402

# ---------------------------------------------------------------------------
# Async SQLite engine (in-memory, shared across a single test run)
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite://"

engine_test = create_async_engine(
    TEST_DATABASE_URL,
    echo=False,
    # SQLite needs ``check_same_thread=False`` when used with async.
    connect_args={"check_same_thread": False},
)

TestingSessionLocal = async_sessionmaker(
    engine_test,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ---------------------------------------------------------------------------
# Type-adaptation: teach SQLAlchemy to compile PG types for the SQLite dialect.
# ---------------------------------------------------------------------------

@event.listens_for(engine_test.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and foreign keys for the SQLite connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# Register compile-time overrides so PG-specific types get rendered as
# something SQLite understands.
from sqlalchemy.ext.compiler import compiles

@compiles(PG_UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):
    return "CHAR(32)"

@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

@compiles(INET, "sqlite")
def _compile_inet_sqlite(type_, compiler, **kw):
    return "VARCHAR"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="session")
async def setup_database():
    """Create all tables once per test session, then drop them at teardown."""
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine_test.dispose()


@pytest_asyncio.fixture()
async def db_session(setup_database) -> AsyncGenerator[AsyncSession, None]:
    """
    Provide a transactional database session that rolls back after each test,
    keeping every test isolated.
    """
    async with engine_test.connect() as conn:
        transaction = await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)

        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()


@pytest_asyncio.fixture()
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    FastAPI test client that uses ``httpx.AsyncClient`` with ``ASGITransport``.
    The ``get_db`` dependency is overridden to inject the test session so all
    requests share the same transactional session.
    """
    from app.main import app

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture()
async def test_user(db_session: AsyncSession) -> User:
    """
    Create a complete test user with:
    - A ``Tenant`` (name="Test Org", slug="test-org")
    - A ``User``   (email="test@example.com", role="tenant_admin")
    - A ``CreditBalance`` seeded with 100 credits

    Returns the ``User`` ORM instance.
    """
    tenant = Tenant(
        id=uuid.uuid4(),
        name="Test Org",
        slug="test-org",
    )
    db_session.add(tenant)
    await db_session.flush()

    user = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email="test@example.com",
        password_hash=hash_password("TestPassword123"),
        full_name="Test User",
        role="tenant_admin",
        is_active=True,
        language="en",
    )
    db_session.add(user)

    credit_balance = CreditBalance(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        balance=100,
        lifetime_purchased=100,
        lifetime_used=0,
    )
    db_session.add(credit_balance)

    await db_session.flush()
    return user


@pytest_asyncio.fixture()
async def auth_headers(test_user: User) -> dict[str, str]:
    """
    Return an ``Authorization: Bearer <token>`` header dict for the test user.
    """
    token = create_access_token(
        data={
            "sub": str(test_user.id),
            "tenant_id": str(test_user.tenant_id),
            "role": test_user.role,
        }
    )
    return {"Authorization": f"Bearer {token}"}
