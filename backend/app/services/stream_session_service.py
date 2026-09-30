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
from app.core.crypto import encrypt_secret, decrypt_secret
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
    match = await session.get(Match, match_id)
    if match is not None:
        from app.services import billing_service

        # One live match credit is reserved here — not later at Go Live — so a
        # user with 1 credit cannot open live sessions on several matches.
        await billing_service.assert_can_prepare_live(session, user, match)
        await billing_service.consume_live(session, user, match)

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
    """Mark that a cameraman opened the link. Not exclusive — many phones may join."""
    _match, row = await get_by_camera_token(session, slug=slug, token=token)
    row.publisher_claimed_at = datetime.now(UTC)
    if row.status is StreamSessionStatus.IDLE:
        row.status = StreamSessionStatus.PREVIEW
    await session.flush()
    return row


def _safe_device_id(raw: str | None) -> str:
    text = "".join(ch for ch in (raw or "") if ch.isalnum())[:16]
    return text or uuid.uuid4().hex[:12]


def device_whip_path(base: str | None, device_id: str) -> str | None:
    if not base:
        return None
    return f"{base.rstrip('/')}/{_safe_device_id(device_id)}"


async def join_device(
    session: AsyncSession, *, slug: str, token: uuid.UUID, device_id: str | None
) -> dict[str, Any]:
    """Give this phone its own WHIP path so many cameras can publish at once."""
    _match, row = await get_by_camera_token(session, slug=slug, token=token)
    safe = _safe_device_id(device_id)
    path = device_whip_path(row.whip_path, safe)
    row.publisher_claimed_at = datetime.now(UTC)
    if row.status is StreamSessionStatus.IDLE:
        row.status = StreamSessionStatus.PREVIEW
    await session.flush()
    return {
        "device_id": safe,
        "whip_path": path,
        "whip_publish_url": whip_publish_url(path),
        "status": row.status.value,
    }


async def update_public_destinations(
    session: AsyncSession,
    *,
    slug: str,
    token: uuid.UUID,
    payload: StreamDestinationUpdate,
) -> tuple[StreamSession, str | None]:
    _match, row = await get_by_camera_token(session, slug=slug, token=token)
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


def _publish_path(row: StreamSession, device_id: str | None, whip_path: str | None) -> str | None:
    if whip_path:
        return whip_path.lstrip("/")
    if device_id:
        return device_whip_path(row.whip_path, device_id)
    return row.whip_path


def _match_live_title(match: Match) -> str:
    if match.title:
        return match.title[:255]
    if match.team_a and match.team_b:
        return f"{match.team_a.name} vs {match.team_b.name}"[:255]
    return "ODCC LIVE"


async def _prepare_social_ingest(row: StreamSession, match: Match) -> None:
    from app.services import facebook_live

    await facebook_live.prepare_ingest(row, title=_match_live_title(match))


async def _finish_social_ingest(row: StreamSession) -> None:
    from app.services import facebook_live

    await facebook_live.finish_ingest(row)


def _facebook_publish_hook(session_id: uuid.UUID):
    async def _publish() -> None:
        from app.db.session import SessionFactory
        from app.services import facebook_live

        async with SessionFactory() as db:
            row = await db.get(StreamSession, session_id)
            if row is None:
                return
            fb = facebook_live.load_social(row).get("facebook") or {}
            live_id = str(fb.get("live_video_id") or "")
            live_token = str(fb.get("live_token") or "")
        if live_id and live_token:
            await facebook_live.set_live_now(live_id, live_token)

    return _publish


def _facebook_refresh_hook(session_id: uuid.UUID, title: str):
    async def _refresh() -> tuple[str, str] | None:
        from app.db.session import SessionFactory
        from app.services import facebook_live

        async with SessionFactory() as db:
            row = await db.get(StreamSession, session_id)
            if row is None:
                return None
            await facebook_live.finish_ingest(row)
            ok = await facebook_live.prepare_ingest(row, title=title)
            await db.commit()
            if not ok or not row.rtmp_url or not row.stream_key_encrypted:
                return None
            try:
                key = decrypt_secret(row.stream_key_encrypted)
            except BadRequest:
                return None
            return row.rtmp_url, key

    return _refresh


def _restream(row: StreamSession, path: str | None, *, title: str = "ODCC LIVE") -> None:
    if not path or not row.rtmp_url or not row.stream_key_encrypted:
        return
    from app.services import facebook_live, restream_service

    try:
        key = decrypt_secret(row.stream_key_encrypted)
    except BadRequest:
        return
    refresh = _facebook_refresh_hook(row.id, title) if facebook_live.ingest_ready(row) else None
    restream_service.schedule(
        path,
        row.rtmp_url,
        key,
        delay_s=0.5,
        on_healthy=_facebook_publish_hook(row.id) if refresh else None,
        on_refresh=refresh,
    )


async def go_live_public(
    session: AsyncSession,
    *,
    slug: str,
    token: uuid.UUID,
    device_id: str | None = None,
    whip_path: str | None = None,
) -> StreamSession:
    match, row = await get_by_camera_token(session, slug=slug, token=token)
    if row.status is StreamSessionStatus.ENDED:
        raise BadRequest("Cannot go live on an ended session.", code="stream_ended")
    from app.services import billing_service

    owner = await session.get(User, match.created_by_user_id)
    billed = owner or (await session.get(User, row.created_by_user_id))
    if billed is not None:
        await billing_service.assert_can_prepare_live(session, billed, match)
        await billing_service.consume_live(session, billed, match)
    await _prepare_social_ingest(row, match)
    row.status = StreamSessionStatus.LIVE
    row.started_at = row.started_at or datetime.now(UTC)
    row.publisher_claimed_at = datetime.now(UTC)
    row.last_error = None
    await session.flush()
    _restream(row, _publish_path(row, device_id, whip_path), title=_match_live_title(match))
    return row


async def end_public(
    session: AsyncSession,
    *,
    slug: str,
    token: uuid.UUID,
    device_id: str | None = None,
    whip_path: str | None = None,
) -> StreamSession:
    """A single phone stopping must not kill the shared QR for everyone else."""
    from app.services import restream_service

    _match, row = await get_by_camera_token(session, slug=slug, token=token)
    path = _publish_path(row, device_id, whip_path)
    if path:
        restream_service.stop(path)
    await _finish_social_ingest(row)
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
    from sqlalchemy.orm import joinedload

    row = await get_session_for_match(session, user, match_id)
    if row.status is StreamSessionStatus.ENDED:
        raise BadRequest("Cannot go live on an ended session.", code="stream_ended")
    match = (
        await session.execute(
            select(Match)
            .options(joinedload(Match.team_a), joinedload(Match.team_b))
            .where(Match.id == match_id)
            .limit(1)
        )
    ).unique().scalar_one_or_none()
    if match is not None:
        from app.services import billing_service

        await billing_service.assert_can_prepare_live(session, user, match)
        await billing_service.consume_live(session, user, match)
        await _prepare_social_ingest(row, match)
    row.status = StreamSessionStatus.LIVE
    row.started_at = row.started_at or datetime.now(UTC)
    row.publisher_claimed_at = datetime.now(UTC)
    row.last_error = None
    await session.flush()
    title = _match_live_title(match) if match is not None else "ODCC LIVE"
    _restream(row, device_whip_path(row.whip_path, "studio") or row.whip_path, title=title)
    return row


async def end_session(session: AsyncSession, user: User, match_id: uuid.UUID) -> StreamSession:
    from app.services import restream_service

    row = await get_session_for_match(session, user, match_id)
    row.status = StreamSessionStatus.ENDED
    row.ended_at = datetime.now(UTC)
    if row.whip_path:
        restream_service.stop_prefix(row.whip_path)
    await _finish_social_ingest(row)
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
        "whip_publish_url": whip_publish_url(device_whip_path(row.whip_path, "studio")),
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
    from app.services import facebook_live

    payload["facebook"] = facebook_live.public_facebook_status(row)
    payload["facebook_ingest"] = facebook_live.ingest_ready(row)
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
