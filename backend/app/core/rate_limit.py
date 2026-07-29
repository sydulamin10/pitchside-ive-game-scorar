"""Distributed rate limiting.

Fixed-window counters in Redis (`INCR` + `EXPIRE` in one pipeline, which is
atomic on the server) with a bounded in-process fallback so a Redis outage never
removes the protection entirely. Responses always carry the standard
``RateLimit-*`` headers plus ``Retry-After`` on rejection.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass

from fastapi import Request, Response
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.errors import RateLimited
from app.core.logging import get_logger
from app.db.redis import get_redis

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Decision:
    allowed: bool
    limit: int
    remaining: int
    reset_after: int


class _LocalWindows:
    """Per-process fallback. Bounded so it can't become a memory leak."""

    MAX_KEYS = 20_000

    def __init__(self) -> None:
        self._counters: dict[tuple[str, int], int] = defaultdict(int)

    def hit(self, key: str, limit: int, window: int) -> Decision:
        bucket = int(time.time()) // window
        if len(self._counters) > self.MAX_KEYS:
            self._counters = defaultdict(
                int, {k: v for k, v in self._counters.items() if k[1] >= bucket}
            )
        counter_key = (key, bucket)
        self._counters[counter_key] += 1
        count = self._counters[counter_key]
        reset_after = window - (int(time.time()) % window)
        return Decision(count <= limit, limit, max(0, limit - count), reset_after)


_local = _LocalWindows()


async def check(key: str, *, limit: int, window_seconds: int) -> Decision:
    if not settings.RATE_LIMIT_ENABLED:
        return Decision(True, limit, limit, window_seconds)

    client = get_redis()
    if client is None:
        return _local.hit(key, limit, window_seconds)

    bucket = int(time.time()) // window_seconds
    redis_key = settings.redis_key("rl", key, str(bucket))
    try:
        pipe = client.pipeline(transaction=True)
        pipe.incr(redis_key, 1)
        pipe.expire(redis_key, window_seconds + 1)
        count = int((await pipe.execute())[0])
    except (RedisError, OSError) as exc:
        logger.warning("rate_limit_redis_unavailable", error=str(exc))
        return _local.hit(key, limit, window_seconds)

    reset_after = window_seconds - (int(time.time()) % window_seconds)
    return Decision(count <= limit, limit, max(0, limit - count), reset_after)


def _apply_headers(response: Response, decision: Decision) -> None:
    response.headers["RateLimit-Limit"] = str(decision.limit)
    response.headers["RateLimit-Remaining"] = str(decision.remaining)
    response.headers["RateLimit-Reset"] = str(decision.reset_after)


async def enforce(
    request: Request,
    response: Response,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    identity: str | None = None,
) -> None:
    who = identity or _identity(request)
    decision = await check(f"{bucket}:{who}", limit=limit, window_seconds=window_seconds)
    _apply_headers(response, decision)
    if not decision.allowed:
        logger.warning("rate_limited", bucket=bucket, identity=who)
        raise RateLimited(
            "Too many requests. Please wait a moment and try again.",
            details={"retry_after_seconds": decision.reset_after},
            headers={"Retry-After": str(decision.reset_after)},
        )


def _identity(request: Request) -> str:
    user = getattr(request.state, "user_id", None)
    if user:
        return f"u:{user}"
    return f"ip:{getattr(request.state, 'client_ip', 'unknown')}"


class RateLimit:
    """Reusable FastAPI dependency: ``Depends(RateLimit('auth', 20, 900))``."""

    def __init__(self, bucket: str, limit: int, window_seconds: int) -> None:
        self.bucket = bucket
        self.limit = limit
        self.window_seconds = window_seconds

    async def __call__(self, request: Request, response: Response) -> None:
        await enforce(
            request,
            response,
            bucket=self.bucket,
            limit=self.limit,
            window_seconds=self.window_seconds,
        )


# Pre-configured limiters used across the API surface.
auth_rate_limit = RateLimit("auth", settings.RATE_LIMIT_AUTH_PER_15MIN, 900)
write_rate_limit = RateLimit("write", settings.RATE_LIMIT_WRITE_PER_MINUTE, 60)
public_rate_limit = RateLimit("public", settings.RATE_LIMIT_ANON_PER_MINUTE, 60)
