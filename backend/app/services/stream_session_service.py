"""Broadcast stream sessions (MediaMTX WHIP / RTMP destinations)."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import authorise_match
from app.core.config import settings
from app.core.crypto import encrypt_secret
from app.core.errors import BadRequest, Conflict, NotFound
from app.models.enums import StreamSessionStatus
from app.models.match import Match
from app.models.stream import StreamSession
from app.models.user import User
from app.schemas.stream import StreamDestinationUpdate, StreamSessionCreate

_ACTIVE = (
    StreamSessionStatus.IDLE,
    StreamSessionStatus.PREVIEW,
    StreamSessionStatus.LIVE,
)


async def create_session(
    session: AsyncSession,
    user: User,
    match_id: uuid.UUID,
    payload: StreamSessionCreate,
) -> tuple[StreamSession, str]:
    await authorise_match(session, match_id, user, write=True)
    existing = await get_active_session(session, match_id)
    if existing is not None:
        raise Conflict(
            "This match already has an active stream session.",
            code="stream_session_active",
        )

    stream_key = payload.stream_key or secrets.token_urlsafe(18)
    whip_path = payload.whip_path or f"pitchside/{match_id.hex[:12]}"
    row = StreamSession(
        match_id=match_id,
        created_by_user_id=user.id,
        status=StreamSessionStatus.IDLE,
        destination_label=payload.destination_label,
        rtmp_url=payload.rtmp_url or _default_rtmp_url(whip_path),
        stream_key_encrypted=encrypt_secret(stream_key),
        whip_path=whip_path,
        camera_token=uuid.uuid4(),
    )
    session.add(row)
    await session.flush()
    return row, stream_key


async def ensure_session(
    session: AsyncSession,
    user: User,
    match_id: uuid.UUID,
) -> tuple[StreamSession, str | None]:
    """Return the active session, creating one if needed (for Go Live QR)."""
    await authorise_match(session, match_id, user, write=True)
    existing = await get_active_session(session, match_id)
    if existing is not None:
        if existing.camera_token is None:
            existing.camera_token = uuid.uuid4()
            await session.flush()
        return existing, None
    return await create_session(session, user, match_id, StreamSessionCreate())


async def get_active_session(
    session: AsyncSession, match_id: uuid.UUID
) -> StreamSession | None:
    return (
        await session.execute(
            select(StreamSession)
            .where(StreamSession.match_id == match_id, StreamSession.status.in_(_ACTIVE))
            .order_by(StreamSession.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_session_for_match(
    session: AsyncSession, user: User, match_id: uuid.UUID
) -> StreamSession:
    await authorise_match(session, match_id, user, write=True)
    row = await get_active_session(session, match_id)
    if row is None:
        raise NotFound("No active stream session for this match.", code="stream_session_not_found")
    return row


async def get_by_camera_token(
    session: AsyncSession, *, slug: str, token: uuid.UUID
) -> tuple[Match, StreamSession]:
    from sqlalchemy.orm import joinedload

    match = (
        await session.execute(
            select(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .where(Match.public_slug == slug, Match.deleted_at.is_(None))
            .limit(1)
        )
    ).unique().scalar_one_or_none()
    if match is None:
        raise NotFound("That match link is not valid.", code="match_not_found")
    row = (
        await session.execute(
            select(StreamSession)
            .where(
                StreamSession.match_id == match.id,
                StreamSession.camera_token == token,
                StreamSession.status.in_(_ACTIVE),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFound(
            "That camera link is not valid, or the stream session has ended.",
            code="camera_token_invalid",
        )
    return match, row


async def claim_publisher(
    session: AsyncSession, *, slug: str, token: uuid.UUID
) -> StreamSession:
    _match, row = await get_by_camera_token(session, slug=slug, token=token)
    row.publisher_claimed_at = datetime.now(UTC)
    if row.status is StreamSessionStatus.IDLE:
        row.status = StreamSessionStatus.PREVIEW
    await session.flush()
    return row


async def go_live_public(
    session: AsyncSession, *, slug: str, token: uuid.UUID
) -> StreamSession:
    _match, row = await get_by_camera_token(session, slug=slug, token=token)
    if row.status is StreamSessionStatus.ENDED:
        raise BadRequest("Cannot go live on an ended session.", code="stream_ended")
    row.status = StreamSessionStatus.LIVE
    row.started_at = row.started_at or datetime.now(UTC)
    row.publisher_claimed_at = datetime.now(UTC)
    row.last_error = None
    await session.flush()
    return row


async def end_public(session: AsyncSession, *, slug: str, token: uuid.UUID) -> StreamSession:
    _match, row = await get_by_camera_token(session, slug=slug, token=token)
    row.status = StreamSessionStatus.ENDED
    row.ended_at = datetime.now(UTC)
    await session.flush()
    return row


async def update_destinations(
    session: AsyncSession,
    user: User,
    match_id: uuid.UUID,
    payload: StreamDestinationUpdate,
) -> tuple[StreamSession, str | None]:
    row = await get_session_for_match(session, user, match_id)
    if row.status is StreamSessionStatus.ENDED:
        raise BadRequest("Cannot update an ended stream session.", code="stream_ended")
    data = payload.model_dump(exclude_unset=True)
    stream_key: str | None = None
    if "stream_key" in data:
        stream_key = data.pop("stream_key")
        if stream_key:
            row.stream_key_encrypted = encrypt_secret(stream_key)
    for field, value in data.items():
        setattr(row, field, value)
    await session.flush()
    return row, stream_key


async def go_live(session: AsyncSession, user: User, match_id: uuid.UUID) -> StreamSession:
    row = await get_session_for_match(session, user, match_id)
    if row.status is StreamSessionStatus.ENDED:
        raise BadRequest("Cannot go live on an ended session.", code="stream_ended")
    row.status = StreamSessionStatus.LIVE
    row.started_at = row.started_at or datetime.now(UTC)
    row.publisher_claimed_at = datetime.now(UTC)
    row.last_error = None
    await session.flush()
    return row


async def end_session(session: AsyncSession, user: User, match_id: uuid.UUID) -> StreamSession:
    row = await get_session_for_match(session, user, match_id)
    row.status = StreamSessionStatus.ENDED
    row.ended_at = datetime.now(UTC)
    await session.flush()
    return row


def session_to_dict(row: StreamSession, *, stream_key: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(row.id),
        "match_id": str(row.match_id),
        "status": row.status.value,
        "destination_label": row.destination_label,
        "rtmp_url": row.rtmp_url,
        "whip_path": row.whip_path,
        "whip_publish_url": whip_publish_url(row.whip_path),
        "has_stream_key": bool(row.stream_key_encrypted),
        "camera_token": str(row.camera_token) if row.camera_token else None,
        "camera_url": None,
        "publisher_claimed_at": row.publisher_claimed_at,
        "last_error": row.last_error,
        "started_at": row.started_at,
        "ended_at": row.ended_at,
        "created_by_user_id": str(row.created_by_user_id),
        "created_at": row.created_at,
    }
    if stream_key is not None:
        payload["stream_key"] = stream_key
    return payload


def attach_camera_url(payload: dict[str, Any], slug: str) -> dict[str, Any]:
    token = payload.get("camera_token")
    if token:
        payload["camera_url"] = settings.public_camera_url(slug, str(token))
        payload["camera_qr_url"] = (
            f"{settings.PUBLIC_API_URL.rstrip('/')}/api/v1/public/matches/"
            f"{slug}/camera/{token}/qr"
        )
    return payload


def whip_publish_url(whip_path: str | None) -> str | None:
    if not whip_path:
        return None
    base = settings.MEDIAMTX_WHIP_BASE_URL.rstrip("/") + "/"
    path = whip_path.lstrip("/")
    # MediaMTX WHIP publish endpoint is ``{path}/whip``.
    if not path.endswith("/whip"):
        path = f"{path.rstrip('/')}/whip"
    url = urljoin(base, path)
    # Render free has no MediaMTX. A localhost WHIP URL makes phones spin on
    # ERR_CONNECTION_REFUSED ("reconnecting…") instead of a clear setup error.
    if settings.is_production and _is_loopback_url(url):
        return None
    return url


def _is_loopback_url(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host in {"localhost", "127.0.0.1", "::1"}


def _default_rtmp_url(whip_path: str) -> str:
    base = settings.MEDIAMTX_RTMP_BASE_URL.rstrip("/")
    return f"{base}/{whip_path.lstrip('/')}"
