"""Server-sent events: the live feed behind every scoreboard on the page.

SSE rather than WebSockets, deliberately: the traffic is one-way, it survives
corporate proxies, it reconnects on its own, and it needs no sticky sessions —
any worker can serve any viewer because the fan-out happens in Redis.

The database session is opened only to resolve the slug and take the first
snapshot, then released. A stream that lasts an hour must not hold a Postgres
connection for an hour.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Path, Request
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.core.errors import RateLimited
from app.core.logging import get_logger
from app.core.metrics import STREAM_CLIENTS
from app.core.rate_limit import public_rate_limit
from app.db.session import SessionFactory
from app.realtime.broker import broker, channel_for_match
from app.realtime.events import EventType
from app.services import overlay_director, state_cache
from app.services.match_query import load_snapshot

logger = get_logger(__name__)

router = APIRouter(prefix="/stream", tags=["realtime"])

Slug = Path(min_length=3, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$")


@router.get(
    "/matches/{slug}",
    dependencies=[Depends(public_rate_limit)],
    summary="Live score stream (text/event-stream)",
    response_class=EventSourceResponse,
)
async def match_stream(request: Request, slug: str = Slug) -> EventSourceResponse:
    async with SessionFactory() as session:
        snapshot = await load_snapshot(session, slug=slug)
        match_id = str(snapshot.match.id)
        initial = await overlay_director.attach_for(match_id, snapshot.compact())
        await state_cache.put_compact(slug, initial)

    channel = channel_for_match(match_id)
    if broker.subscriber_count_for(channel) >= settings.SSE_MAX_CONNECTIONS_PER_MATCH:
        raise RateLimited(
            "This match has too many live viewers on this server. Please refresh in a moment.",
            code="stream_capacity",
        )

    async def publisher() -> AsyncIterator[dict[str, str]]:
        # The first frame is the full picture, so a client never has to make a
        # second request before it can render something.
        yield {"event": EventType.SCORE_UPDATE.value, "data": json.dumps(initial, default=str)}
        STREAM_CLIENTS.inc()
        try:
            async with broker.subscribe(channel) as queue:
                loop = asyncio.get_running_loop()
                deadline = loop.time() + settings.SSE_MAX_CONNECTION_SECONDS
                while not await request.is_disconnected():
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        # Bounded connections keep worker memory and Upstash
                        # usage predictable; EventSource reconnects by itself.
                        yield {"event": "reconnect", "data": '{"reason":"max_duration"}'}
                        break
                    try:
                        message = await asyncio.wait_for(
                            queue.get(),
                            timeout=min(settings.SSE_KEEPALIVE_SECONDS, remaining),
                        )
                    except TimeoutError:
                        # A comment frame keeps proxies and mobile radios from
                        # dropping an idle connection between overs.
                        yield {"comment": "keepalive"}
                        continue
                    yield {"event": _event_name(message), "data": message}
        finally:
            STREAM_CLIENTS.dec()

    return EventSourceResponse(
        publisher(),
        headers={
            "Cache-Control": "no-store, no-transform",
            # Nginx buffers proxied responses by default, which would defeat the
            # entire point of a live stream.
            "X-Accel-Buffering": "no",
        },
    )


def _event_name(message: str) -> str:
    with contextlib.suppress(json.JSONDecodeError, TypeError, AttributeError):
        name = json.loads(message).get("type")
        if isinstance(name, str):
            return name
    return EventType.SCORE_UPDATE.value
