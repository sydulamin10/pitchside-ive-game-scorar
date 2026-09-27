"""Async SQLAlchemy engine + session plumbing, tuned for Neon Postgres.

Two Neon specifics are handled automatically:

1. **Pooled endpoints** (`...-pooler.neon.tech`) sit behind PgBouncer in
   transaction mode, where server-side prepared statements break. We disable
   psycopg's automatic prepare in that case.
2. **Scale-to-zero cold starts** mean the first connection after idle can be
   slow or stale, so ``pool_pre_ping`` plus a bounded ``pool_recycle`` are on by
   default.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

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


def _connect_args() -> dict[str, Any]:
    args: dict[str, Any] = {
        # Fail fast rather than hanging a worker on an unreachable database.
        "connect_timeout": 10,
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


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session bound to the request lifecycle.

    The session is rolled back on any exception and always closed. Endpoints
    commit explicitly, which keeps transaction boundaries visible in the code
    that owns the business rule rather than hidden in a dependency.
    """
    session = SessionFactory()
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def dispose_engine() -> None:
    await engine.dispose()
    logger.info("database_engine_disposed")
