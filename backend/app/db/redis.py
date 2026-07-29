"""Redis (Upstash) connection management.

Redis is treated as a **performance and fan-out layer, never a source of
truth**. Every call site degrades gracefully when Redis is absent or failing:
cached state is recomputed from Postgres, rate limiting falls back to a
per-process limiter, and realtime fan-out falls back to in-process delivery.
That means a Redis outage slows the product down; it does not take it down.
"""

from __future__ import annotations

import contextlib
from typing import Any

import redis.asyncio as aioredis
from redis.asyncio.client import Redis
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: Redis | None = None


def _build_client() -> Redis | None:
    if not settings.REDIS_URL:
        logger.warning(
            "redis_not_configured", detail="Running without cache or cross-worker fan-out"
        )
        return None
    kwargs: dict[str, Any] = {
        "decode_responses": True,
        "socket_timeout": settings.REDIS_SOCKET_TIMEOUT_SECONDS,
        "socket_connect_timeout": settings.REDIS_SOCKET_TIMEOUT_SECONDS,
        "socket_keepalive": True,
        "health_check_interval": 30,
        "retry_on_timeout": True,
        "max_connections": 32,
    }
    return aioredis.from_url(settings.REDIS_URL, **kwargs)


async def init_redis() -> Redis | None:
    global _client
    if _client is not None:
        return _client
    client = _build_client()
    if client is None:
        return None
    try:
        await client.ping()
    except (RedisError, OSError) as exc:
        logger.error("redis_connect_failed", error=str(exc))
        # Keep the client: redis-py reconnects lazily, so a late-starting cache
        # will simply begin working without a deploy.
    else:
        logger.info("redis_connected")
    _client = client
    return _client


def get_redis() -> Redis | None:
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        # A cache we are shutting down anyway is not worth failing a shutdown for.
        with contextlib.suppress(RedisError, OSError):
            await _client.aclose()
        _client = None
        logger.info("redis_closed")


async def redis_healthy() -> bool:
    client = get_redis()
    if client is None:
        return False
    try:
        return bool(await client.ping())
    except (RedisError, OSError):
        return False
