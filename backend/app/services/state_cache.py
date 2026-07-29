"""Redis-backed read cache for derived match state.

The public scorecard is the hottest endpoint in the product — one live match can
be open on hundreds of phones — while the underlying data changes only when a
scorer taps a button. So the write path recomputes and *pushes* the fresh payload
into Redis, and readers serve straight from it.

Cache misses are always safe: the payload is recomputed from the delivery log.
"""

from __future__ import annotations

from typing import Any

import orjson
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.logging import get_logger
from app.db.redis import get_redis

logger = get_logger(__name__)

_SCORECARD = "scorecard"
_COMPACT = "compact"


def _key(kind: str, identifier: str) -> str:
    return settings.redis_key("cache", kind, identifier)


async def get_json(kind: str, identifier: str) -> dict[str, Any] | None:
    client = get_redis()
    if client is None:
        return None
    try:
        raw = await client.get(_key(kind, identifier))
    except (RedisError, OSError) as exc:
        logger.warning("cache_read_failed", kind=kind, error=str(exc))
        return None
    if not raw:
        return None
    try:
        payload: dict[str, Any] = orjson.loads(raw)
    except orjson.JSONDecodeError:  # pragma: no cover - corrupt entry
        return None
    return payload


async def set_json(
    kind: str, identifier: str, payload: dict[str, Any], *, ttl_seconds: int | None = None
) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        await client.set(
            _key(kind, identifier),
            orjson.dumps(payload, default=str),
            ex=ttl_seconds or settings.STATE_CACHE_TTL_SECONDS,
        )
    except (RedisError, OSError) as exc:
        logger.warning("cache_write_failed", kind=kind, error=str(exc))


async def delete(kind: str, identifier: str) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        await client.delete(_key(kind, identifier))
    except (RedisError, OSError) as exc:  # pragma: no cover
        logger.warning("cache_delete_failed", kind=kind, error=str(exc))


# ------------------------------------------------------------- typed accessors


async def get_scorecard(slug: str) -> dict[str, Any] | None:
    return await get_json(_SCORECARD, slug)


async def put_scorecard(slug: str, payload: dict[str, Any]) -> None:
    await set_json(_SCORECARD, slug, payload)


async def get_compact(slug: str) -> dict[str, Any] | None:
    return await get_json(_COMPACT, slug)


async def put_compact(slug: str, payload: dict[str, Any]) -> None:
    await set_json(_COMPACT, slug, payload)


async def invalidate_match(slug: str) -> None:
    await delete(_SCORECARD, slug)
    await delete(_COMPACT, slug)


async def get_standings(tournament_slug: str) -> dict[str, Any] | None:
    return await get_json("standings", tournament_slug)


async def put_standings(tournament_slug: str, payload: dict[str, Any]) -> None:
    await set_json("standings", tournament_slug, payload)


async def invalidate_standings(tournament_slug: str) -> None:
    await delete("standings", tournament_slug)
