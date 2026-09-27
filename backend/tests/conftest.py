"""Shared test fixtures.

Environment variables are set *before* any application module is imported,
because settings are read once at import time (which is what makes them safe to
use as a module-level singleton in the app).

Two tiers of tests live in this suite:

* Unit / API-surface tests, which need nothing but Python. They run everywhere.
* Integration tests, which need a real Postgres. They are marked ``integration``
  and skip themselves unless ``TEST_DATABASE_URL`` is set — CI provides one, and
  a developer can point it at a Neon branch.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from collections.abc import AsyncIterator, Iterator

os.environ.setdefault("ENV", "test")
os.environ.setdefault("AUTO_MIGRATE", "false")
os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-long-enough-for-hs256-signing")
os.environ.setdefault("LOG_JSON", "false")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("METRICS_ENABLED", "false")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("ALLOW_REGISTRATION", "true")
os.environ.setdefault("AUTO_APPROVE_REGISTRATION", "true")
os.environ.setdefault("BILLING_ENFORCE", "false")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
# Keep Argon2 cheap so the auth tests are not the slowest thing in the suite.
os.environ.setdefault("ARGON2_TIME_COST", "1")
os.environ.setdefault("ARGON2_MEMORY_COST_KIB", "8192")
os.environ.pop("REDIS_URL", None)

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.main import create_app  # noqa: E402

requires_db = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="set TEST_DATABASE_URL to run database-backed tests",
)

if sys.platform == "win32":
    # psycopg cannot talk to Postgres on Windows' default proactor loop, so the
    # suite runs on a selector loop there. CI (Linux) uses the default.
    def pytest_asyncio_loop_factories(config: object, item: object) -> dict[str, object]:
        return {"selector": asyncio.SelectorEventLoop}


@pytest.fixture(scope="session")
def app():
    return create_app()


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    """Synchronous client. Runs the lifespan, so the broker is live."""
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture
async def api(app) -> AsyncIterator[AsyncClient]:
    """Async client for the database-backed flows."""
    from app.db.redis import init_redis
    from app.realtime.broker import broker

    await init_redis()
    await broker.start()
    transport = ASGITransport(app=app)
    base_url = "http://testserver/api/v1"
    async with AsyncClient(transport=transport, base_url=base_url) as async_client:
        yield async_client
    await broker.stop()


@pytest.fixture(scope="session")
def _database_ready() -> bool:
    """Create the schema once for the whole session."""
    if not TEST_DATABASE_URL:
        return False
    from sqlalchemy import create_engine, text

    import app.models  # noqa: F401  (registers every table on Base.metadata)
    from app.core.config import settings
    from app.db.base import Base

    engine = create_engine(settings.sync_database_url, future=True)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
        Base.metadata.create_all(connection)
    engine.dispose()
    return True


@pytest.fixture
async def db(_database_ready):
    """A clean database for every test, with the session's schema reused."""
    if not _database_ready:
        pytest.skip("no test database configured")
    from sqlalchemy import text

    from app.db.session import SessionFactory, engine

    tables = [
        "delivery_revisions",
        "deliveries",
        "innings_summaries",
        "innings",
        "match_players",
        "match_collaborators",
        "stream_sessions",
        "bracket_matches",
        "tournament_standings",
        "tournament_teams",
        "tournament_groups",
        "matches",
        "player_awards",
        "team_memberships",
        "tournaments",
        "players",
        "teams",
        "refresh_tokens",
        "audit_logs",
        "billing_live_usage",
        "billing_payments",
        "billing_coupons",
        "users",
    ]
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE {', '.join(tables)} CASCADE"))
    async with SessionFactory() as session:
        yield session


@pytest.fixture
def unique_email() -> str:
    return f"scorer-{uuid.uuid4().hex[:10]}@example.org"
