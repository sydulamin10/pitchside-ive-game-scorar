"""Async SQLAlchemy engine + session plumbing, tuned for Neon Postgres.

Two Neon specifics are handled automatically:

1. **Pooled endpoints** (`...-pooler.neon.tech`) sit behind PgBouncer in
   transaction mode, where server-side prepared statements break. We disable
   psycopg's automatic prepare in that case.
2. **Scale-to-zero cold starts** mean the first connection after idle can be
   slow or stale. ``pool_pre_ping``, a bounded recycle, connect retries, and a
   keepalive ping keep login from failing with "database is waking up".
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_TRANSIENT_DETAIL = (
    "connection refused",
    "could not connect",
    "server closed the connection",
    "connection timed out",
    "the connection is closed",
    "ssl connection has been closed",
    "connection reset",
    "too many connections",
    "remaining connection slots",
    "temporarily unavailable",
    "compute is not active",
    "endpoint is disabled",
    "can't connect",
    "timeout expired",
    "could not translate host name",
)


def is_transient_db_error(exc: BaseException) -> bool:
    """True when retrying is likely to succeed (Neon cold start, dropped socket)."""
    orig = getattr(exc, "orig", None)
    detail = str(orig or exc).lower()
    if "exceeded the quota" in detail or "upgrade your plan" in detail:
        return False
    if isinstance(exc, OperationalError):
        return True
    sqlstate = str(getattr(orig, "sqlstate", "") or "")
    if sqlstate.startswith("08"):
        return True
    return any(needle in detail for needle in _TRANSIENT_DETAIL)


def _connect_args() -> dict[str, Any]:
    args: dict[str, Any] = {
        "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
    }
    pooled = "-pooler." in settings.DATABASE_URL or "pgbouncer=true" in settings.DATABASE_URL
    if pooled:
        # Neon PgBouncer rejects startup `options` such as statement_timeout.
        args["prepare_threshold"] = None
    else:
        args["options"] = f"-c statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS}"
    return args


def create_engine() -> AsyncEngine:
    use_null_pool = settings.ENV == "test"
    kwargs: dict[str, Any] = {
        "echo": settings.DB_ECHO,
        "future": True,
        "pool_pre_ping": settings.DB_POOL_PRE_PING,
        "connect_args": _connect_args(),
    }
    if use_null_pool:
        kwargs["poolclass"] = NullPool
    else:
        kwargs.update(
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
            pool_timeout=30,
        )
    return create_async_engine(settings.DATABASE_URL, **kwargs)


engine: AsyncEngine = create_engine()

SessionFactory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
    class_=AsyncSession,
)


async def open_session() -> AsyncSession:
    """Open a session, retrying while Neon compute is still starting."""
    attempts = max(1, settings.DB_CONNECT_ATTEMPTS)
    last_error: BaseException | None = None
    for attempt in range(1, attempts + 1):
        session = SessionFactory()
        try:
            await session.connection()
            return session
        except Exception as exc:
            await session.close()
            last_error = exc
            if not is_transient_db_error(exc) or attempt >= attempts:
                raise
            logger.warning("database_connect_retry", attempt=attempt, error=str(exc))
            if attempt == 2:
                await engine.dispose()
            await asyncio.sleep(min(8, attempt))
    assert last_error is not None
    raise last_error


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session bound to the request lifecycle.

    The session is rolled back on any exception and always closed. Endpoints
    commit explicitly, which keeps transaction boundaries visible in the code
    that owns the business rule rather than hidden in a dependency.
    """
    session = await open_session()
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def keep_database_awake(stop: asyncio.Event) -> None:
    """Periodic ``SELECT 1`` so a Neon compute endpoint does not scale to zero."""
    interval = settings.DB_KEEPALIVE_SECONDS
    if interval <= 0:
        return
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
            return
        except TimeoutError:
            pass
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
                await conn.commit()
        except Exception:
            logger.warning("database_keepalive_failed", exc_info=True)
            try:
                await engine.dispose()
            except Exception:
                logger.warning("database_pool_dispose_failed", exc_info=True)


async def dispose_engine() -> None:
    await engine.dispose()
    logger.info("database_engine_disposed")
