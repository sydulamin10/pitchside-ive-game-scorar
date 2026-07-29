"""Realtime fan-out.

One Redis pub/sub connection per process multiplexes every match channel and
pushes onto in-memory queues, so 2,000 viewers on one match cost one Redis
subscription rather than 2,000. When Redis is not configured the broker degrades
to purely in-process delivery, which is correct for a single worker and is what
local development uses.

Back-pressure policy: a viewer whose queue fills up (mobile on a weak signal) is
sent a single ``resync`` frame instead of a growing backlog. The client then
refetches the authoritative scorecard. Dropping data is safe precisely because
the server is the source of truth and every frame carries a ``state_version``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

from redis.exceptions import RedisError

from app.core.config import settings
from app.core.logging import get_logger
from app.db.redis import get_redis

logger = get_logger(__name__)

QUEUE_MAX_SIZE = 32
_CHANNEL_PREFIX = "events"


def channel_for_match(match_id: str) -> str:
    return f"match:{match_id}"


def channel_for_tournament(tournament_id: str) -> str:
    return f"tournament:{tournament_id}"


class Broker:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[str]]] = {}
        self._reader: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._using_redis = False

    # ---------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        client = get_redis()
        if client is None:
            logger.info("broker_started", transport="in_process")
            return
        self._using_redis = True
        self._reader = asyncio.create_task(self._read_forever(), name="broker-reader")
        logger.info("broker_started", transport="redis_pubsub")

    async def stop(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
            self._reader = None
        self._subscribers.clear()
        logger.info("broker_stopped")

    @property
    def subscriber_count(self) -> int:
        return sum(len(queues) for queues in self._subscribers.values())

    def subscriber_count_for(self, channel: str) -> int:
        return len(self._subscribers.get(channel, ()))

    # ------------------------------------------------------------------ publish
    async def publish(self, channel: str, payload: dict[str, Any]) -> None:
        message = json.dumps(payload, separators=(",", ":"), default=str)
        client = get_redis()
        if client is not None:
            try:
                await client.publish(self._redis_channel(channel), message)
                return
            except (RedisError, OSError) as exc:
                # Fall through to local delivery so a single-worker deployment
                # keeps working through a cache outage.
                logger.warning("broker_publish_failed", channel=channel, error=str(exc))
        self._dispatch_local(channel, message)

    # ---------------------------------------------------------------- subscribe
    @contextlib.asynccontextmanager
    async def subscribe(self, channel: str) -> AsyncIterator[asyncio.Queue[str]]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAX_SIZE)
        async with self._lock:
            self._subscribers.setdefault(channel, set()).add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                listeners = self._subscribers.get(channel)
                if listeners is not None:
                    listeners.discard(queue)
                    if not listeners:
                        self._subscribers.pop(channel, None)

    # ------------------------------------------------------------------ internal
    def _redis_channel(self, channel: str) -> str:
        return settings.redis_key(_CHANNEL_PREFIX, channel)

    def _dispatch_local(self, channel: str, message: str) -> None:
        for queue in tuple(self._subscribers.get(channel, ())):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                _drain_and_mark_stale(queue)

    async def _read_forever(self) -> None:
        """Keep one pattern subscription alive, reconnecting with backoff."""
        pattern = settings.redis_key(_CHANNEL_PREFIX, "*")
        backoff = 1.0
        while True:
            client = get_redis()
            if client is None:  # pragma: no cover - configuration change at runtime
                await asyncio.sleep(5)
                continue
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            try:
                await pubsub.psubscribe(pattern)
                backoff = 1.0
                async for raw in pubsub.listen():
                    if raw is None or raw.get("type") != "pmessage":
                        continue
                    channel = str(raw["channel"]).split(f"{_CHANNEL_PREFIX}:", 1)[-1]
                    self._dispatch_local(channel, str(raw["data"]))
            except asyncio.CancelledError:
                raise
            except (RedisError, OSError) as exc:
                logger.warning("broker_reader_reconnecting", error=str(exc), backoff=backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()


def _drain_and_mark_stale(queue: asyncio.Queue[str]) -> None:
    """A slow client gets one resync instruction rather than a stale backlog."""
    while not queue.empty():
        with contextlib.suppress(asyncio.QueueEmpty):
            queue.get_nowait()
    with contextlib.suppress(asyncio.QueueFull):
        queue.put_nowait(json.dumps({"type": "resync"}))


broker = Broker()
