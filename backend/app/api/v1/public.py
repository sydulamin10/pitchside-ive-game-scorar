"""Public, unauthenticated read endpoints.

These serve the share links: the live scorecard, the broadcast overlay, the
points table, and the bracket. They are the highest-traffic part of the product,
so every response is served from the Redis projection when it is warm and carries
an ``ETag``/``Cache-Control`` pair so repeat viewers and CDNs are cheap.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from fastapi.responses import Response as RawResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import uuid

from app.api.deps import SessionDep
from app.core.config import settings
from app.core.errors import NotFound
from app.core.rate_limit import public_rate_limit
from app.models.match import Match
from app.models.team import Team
from app.models.tournament import Tournament
from app.schemas.team import PlayerPublicOut, TeamPublicOut
from app.services import career_stats, state_cache, team_service, tournament_service
from app.services.match_query import load_snapshot

router = APIRouter(prefix="/public", tags=["public"], dependencies=[Depends(public_rate_limit)])

Slug = Path(min_length=3, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$")
IdOrSlug = Path(min_length=1, max_length=120)

#: Short enough that a viewer refreshing feels live, long enough to absorb a
#: thundering herd on a popular match.
LIVE_CACHE_SECONDS = 5
FINISHED_CACHE_SECONDS = 300


def _apply_cache_headers(response: Response, payload: dict[str, Any]) -> None:
    match = payload.get("match") or {}
    version = match.get("state_version", payload.get("state_version", 0))
    status = match.get("status", payload.get("status"))
    max_age = FINISHED_CACHE_SECONDS if status in ("completed", "abandoned") else LIVE_CACHE_SECONDS
    response.headers["ETag"] = f'W/"{version}"'
    response.headers["Cache-Control"] = f"public, max-age={max_age}"


def _not_modified(request: Request, response: Response) -> bool:
    incoming = request.headers.get("if-none-match")
    return bool(incoming) and incoming == response.headers.get("ETag")


@router.get("/matches/{slug}", summary="Public scorecard", response_model=None)
async def public_match(
    request: Request,
    response: Response,
    session: SessionDep,
    slug: str = Slug,
) -> Any:
    payload = await state_cache.get_scorecard(slug)
    if payload is None:
        snapshot = await load_snapshot(session, slug=slug)
        payload = snapshot.to_dict()
        await state_cache.put_scorecard(slug, payload)
    _apply_cache_headers(response, payload)
    if _not_modified(request, response):
        return Response(status_code=304, headers=dict(response.headers))
    return payload


@router.get("/matches/{slug}/state", summary="Compact live state", response_model=None)
async def public_match_state(
    request: Request,
    response: Response,
    session: SessionDep,
    slug: str = Slug,
) -> Any:
    payload = await state_cache.get_compact(slug)
    if payload is None:
        snapshot = await load_snapshot(session, slug=slug)
        payload = snapshot.compact()
        await state_cache.put_compact(slug, payload)
    _apply_cache_headers(response, payload)
    if _not_modified(request, response):
        return Response(status_code=304, headers=dict(response.headers))
    return payload


@router.get("/matches/{slug}/overlay", summary="Broadcast overlay feed", response_model=None)
async def public_overlay(
    response: Response, session: SessionDep, slug: str = Slug
) -> dict[str, Any]:
    """Everything a stream overlay needs, and nothing it does not."""
    payload = await state_cache.get_compact(slug)
    if payload is None:
        snapshot = await load_snapshot(session, slug=slug)
        payload = snapshot.compact()
        await state_cache.put_compact(slug, payload)
    response.headers["Cache-Control"] = "no-store"
    score = payload.get("score") or {}
    batting = payload.get("batting_team") or {}
    bowling = payload.get("bowling_team") or {}
    tournament = payload.get("tournament")
    toss = payload.get("toss") or {}
    return {
        "status": payload.get("status"),
        "state_version": payload.get("state_version"),
        "venue": payload.get("venue"),
        "city": payload.get("city"),
        "tournament": tournament,
        "toss": toss,
        "batting": {
            "name": batting.get("name"),
            "short_name": batting.get("short_name"),
            "logo_url": batting.get("logo_url"),
            "primary_color": batting.get("primary_color"),
        },
        "bowling": {
            "name": bowling.get("name"),
            "short_name": bowling.get("short_name"),
            "logo_url": bowling.get("logo_url"),
            "primary_color": bowling.get("primary_color"),
        },
        "score_text": f"{score.get('runs', 0)}/{score.get('wickets', 0)}",
        "overs_text": score.get("overs_text"),
        "run_rate": score.get("run_rate"),
        "required_run_rate": score.get("required_run_rate"),
        "target_runs": score.get("target_runs"),
        "runs_needed": score.get("runs_needed"),
        "balls_remaining": score.get("balls_remaining"),
        "is_free_hit": score.get("is_free_hit"),
        "striker": payload.get("striker"),
        "non_striker": payload.get("non_striker"),
        "bowler": payload.get("bowler"),
        "partnership": payload.get("current_partnership"),
        "recent_balls": [ball.get("display") for ball in payload.get("recent_balls", [])],
        "result_summary": payload.get("result_summary"),
    }


@router.get(
    "/matches/{slug}/awards",
    summary="Post-match awards and MVP ratings",
    response_model=None,
)
async def public_match_awards(
    response: Response, session: SessionDep, slug: str = Slug
) -> dict[str, Any]:
    from app.services.match_awards import compute_match_awards

    snapshot = await load_snapshot(session, slug=slug)
    awards = compute_match_awards(snapshot)
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return awards


@router.get(
    "/matches/{slug}/camera/{token}",
    summary="External camera invite info",
    response_model=None,
)
async def public_camera_info(
    response: Response,
    session: SessionDep,
    slug: str = Slug,
    token: uuid.UUID = Path(...),
) -> dict[str, Any]:
    from app.services import stream_session_service

    match, row = await stream_session_service.get_by_camera_token(
        session, slug=slug, token=token
    )
    response.headers["Cache-Control"] = "no-store"
    title = match.title
    if not title:
        title = f"{match.team_a.name} vs {match.team_b.name}" if match.team_a and match.team_b else "Match"
    return {
        "slug": match.public_slug,
        "match_id": str(match.id),
        "title": title,
        "status": row.status.value,
        "publisher_claimed": row.publisher_claimed_at is not None,
        "whip_publish_url": stream_session_service.whip_publish_url(row.whip_path),
        "destination_label": row.destination_label,
        "camera_url": settings.public_camera_url(match.public_slug, str(token)),
    }


@router.get(
    "/matches/{slug}/overlay/qr",
    summary="QR SVG for the broadcast overlay URL (Facebook / YouTube / OBS)",
    response_model=None,
)
async def public_overlay_qr(
    session: SessionDep,
    slug: str = Slug,
    design: str = Query(default="circle", max_length=32),
    position: str = Query(default="bottom", pattern="^(bottom|top)$"),
    origin: str | None = Query(
        default=None,
        description="Optional web origin so LAN QR codes open the scorer's host.",
        max_length=200,
    ),
) -> RawResponse:
    """Encode a transparent overlay browser-source URL for Live Producer / OBS."""
    from urllib.parse import urlencode, urlparse

    from app.utils.qr import qr_png_bytes

    exists = (
        await session.execute(
            select(Match.id).where(Match.public_slug == slug, Match.deleted_at.is_(None)).limit(1)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise NotFound("That match link is not valid.", code="match_not_found")

    base = settings.PUBLIC_WEB_URL.rstrip("/")
    if origin:
        parsed = urlparse(origin.strip())
        if parsed.scheme in ("http", "https") and parsed.netloc:
            base = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    safe_design = "".join(ch for ch in design.lower() if ch.isalnum() or ch in "-_")[:32] or "circle"
    query = urlencode({"design": safe_design, "position": position})
    url = f"{base}/s/{slug}/overlay?{query}"
    return RawResponse(
        content=qr_png_bytes(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@router.get(
    "/matches/{slug}/camera/{token}/qr",
    summary="QR SVG for the external camera link",
    response_model=None,
)
async def public_camera_qr(
    session: SessionDep,
    slug: str = Slug,
    token: uuid.UUID = Path(...),
    origin: str | None = Query(
        default=None,
        description="Optional web origin so LAN QR codes open the host the scorer is using.",
        max_length=200,
    ),
) -> RawResponse:
    from urllib.parse import urlparse

    from app.services import stream_session_service
    from app.utils.qr import qr_png_bytes

    match, _row = await stream_session_service.get_by_camera_token(
        session, slug=slug, token=token
    )
    url = settings.public_camera_url(match.public_slug, str(token))
    if origin:
        parsed = urlparse(origin.strip())
        if parsed.scheme in ("http", "https") and parsed.netloc:
            base = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
            url = f"{base}/s/{match.public_slug}/camera/{token}"
    return RawResponse(
        content=qr_png_bytes(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/matches/{slug}/camera/{token}/claim",
    summary="Cameraman claims the publisher slot",
    response_model=None,
)
async def public_camera_claim(
    session: SessionDep,
    slug: str = Slug,
    token: uuid.UUID = Path(...),
) -> dict[str, Any]:
    from app.services import stream_session_service

    row = await stream_session_service.claim_publisher(session, slug=slug, token=token)
    await session.commit()
    return {"status": row.status.value, "publisher_claimed_at": row.publisher_claimed_at}


@router.post(
    "/matches/{slug}/camera/{token}/go-live",
    summary="Cameraman marks the session live",
    response_model=None,
)
async def public_camera_go_live(
    session: SessionDep,
    slug: str = Slug,
    token: uuid.UUID = Path(...),
) -> dict[str, Any]:
    from app.services import stream_session_service

    row = await stream_session_service.go_live_public(session, slug=slug, token=token)
    await session.commit()
    return {"status": row.status.value, "started_at": row.started_at}


@router.post(
    "/matches/{slug}/camera/{token}/end",
    summary="Cameraman ends the live session",
    response_model=None,
)
async def public_camera_end(
    session: SessionDep,
    slug: str = Slug,
    token: uuid.UUID = Path(...),
) -> dict[str, Any]:
    from app.services import stream_session_service

    row = await stream_session_service.end_public(session, slug=slug, token=token)
    await session.commit()
    return {"status": row.status.value, "ended_at": row.ended_at}


@router.get(
    "/teams/{id_or_slug}",
    response_model=TeamPublicOut,
    summary="Public club profile",
)
async def public_team(
    response: Response, session: SessionDep, id_or_slug: str = IdOrSlug
) -> TeamPublicOut:
    team = await team_service.get_public_team(session, id_or_slug)
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return team_service.enrich_public_team(team)


@router.get(
    "/players/{id_or_slug}",
    response_model=PlayerPublicOut,
    summary="Public player profile",
)
async def public_player(
    response: Response, session: SessionDep, id_or_slug: str = IdOrSlug
) -> PlayerPublicOut:
    player, team = await team_service.get_public_player(session, id_or_slug)
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return team_service.enrich_public_player(player, team)


@router.get(
    "/players/{id_or_slug}/stats",
    summary="Public player career stats",
    response_model=None,
)
async def public_player_stats(
    response: Response,
    session: SessionDep,
    id_or_slug: str = IdOrSlug,
    last_n: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    player, _team = await team_service.get_public_player(session, id_or_slug)
    stats = await career_stats.compute_career_stats(session, player.id, last_n=last_n)
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return stats


@router.get(
    "/players/{id_or_slug}/qr",
    summary="QR code SVG for the public player profile",
    response_model=None,
)
async def public_player_qr(
    session: SessionDep, id_or_slug: str = IdOrSlug
) -> RawResponse:
    from app.utils.qr import qr_png_bytes

    player, _team = await team_service.get_public_player(session, id_or_slug)
    if not player.public_slug:
        raise NotFound("That player profile was not found.", code="player_not_found")
    url = settings.public_player_url(player.public_slug)
    return RawResponse(
        content=qr_png_bytes(url),
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={FINISHED_CACHE_SECONDS}"},
    )


@router.get(
    "/players/{id_or_slug}/awards",
    summary="Public player awards",
    response_model=None,
)
async def public_player_awards(
    response: Response,
    session: SessionDep,
    id_or_slug: str = IdOrSlug,
) -> list[dict[str, Any]]:
    from app.services import award_service

    player, _team = await team_service.get_public_player(session, id_or_slug)
    awards = await award_service.list_awards(session, player.id)
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return [
        {
            "id": str(a.id),
            "player_id": str(a.player_id),
            "team_id": str(a.team_id) if a.team_id else None,
            "kind": a.kind.value,
            "title": a.title,
            "description": a.description,
            "awarded_at": a.awarded_at,
            "image_url": a.image_url,
        }
        for a in awards
    ]


@router.get("/tournaments/{slug}", summary="Public tournament page", response_model=None)
async def public_tournament(
    response: Response, session: SessionDep, slug: str = Slug
) -> dict[str, Any]:
    tournament = await tournament_service.load_tournament(session, slug=slug)
    standings = await state_cache.get_standings(slug)
    if standings is None:
        result = await tournament_service.compute_and_store_standings(session, tournament)
        standings = result.to_dict(tournament)
        await session.commit()
    fixtures = await _fixtures(session, tournament)
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return {
        **standings,
        "fixtures": fixtures,
        "bracket": await _public_bracket(session, tournament),
    }


@router.get("/tournaments/{slug}/standings", summary="Public points table", response_model=None)
async def public_standings(
    response: Response, session: SessionDep, slug: str = Slug
) -> dict[str, Any]:
    cached = await state_cache.get_standings(slug)
    if cached is not None:
        response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
        return cached
    tournament = await tournament_service.load_tournament(session, slug=slug)
    result = await tournament_service.compute_and_store_standings(session, tournament)
    await session.commit()
    response.headers["Cache-Control"] = f"public, max-age={LIVE_CACHE_SECONDS}"
    return result.to_dict(tournament)


@router.get("/tournaments/{slug}/bracket", summary="Public bracket", response_model=None)
async def public_bracket(session: SessionDep, slug: str = Slug) -> list[dict[str, Any]]:
    tournament = await tournament_service.load_tournament(session, slug=slug)
    return await _public_bracket(session, tournament)


# --------------------------------------------------------------------- helpers


async def _fixtures(session: AsyncSession, tournament: Tournament) -> list[dict[str, Any]]:
    rows = await session.execute(
        select(Match)
        .where(Match.tournament_id == tournament.id, Match.deleted_at.is_(None))
        .order_by(Match.scheduled_at.asc().nulls_last(), Match.created_at.asc())
    )
    matches = list(rows.unique().scalars())
    team_ids = {m.team_a_id for m in matches} | {m.team_b_id for m in matches}
    names: dict[Any, str] = {}
    if team_ids:
        name_rows = await session.execute(select(Team.id, Team.name).where(Team.id.in_(team_ids)))
        names = {row.id: row.name for row in name_rows}
    return [
        {
            "id": str(m.id),
            "slug": m.public_slug,
            "title": m.title,
            "status": m.status.value,
            "round": m.tournament_round,
            "scheduled_at": m.scheduled_at,
            "team_a": names.get(m.team_a_id),
            "team_b": names.get(m.team_b_id),
            "result_summary": m.result_summary,
            "share_url": settings.public_match_url(m.public_slug),
        }
        for m in matches
    ]


async def _public_bracket(session: AsyncSession, tournament: Tournament) -> list[dict[str, Any]]:
    team_ids = {b.team_a_id for b in tournament.bracket if b.team_a_id} | {
        b.team_b_id for b in tournament.bracket if b.team_b_id
    }
    names: dict[Any, str] = {}
    if team_ids:
        rows = await session.execute(select(Team.id, Team.name).where(Team.id.in_(team_ids)))
        names = {row.id: row.name for row in rows}

    slugs: dict[Any, str] = {}
    match_ids = [b.match_id for b in tournament.bracket if b.match_id]
    if match_ids:
        rows = await session.execute(
            select(Match.id, Match.public_slug, Match.result_summary).where(Match.id.in_(match_ids))
        )
        slugs = {row.id: row.public_slug for row in rows}

    return [
        {
            "id": str(node.id),
            "round": node.round.value,
            "ordinal": node.ordinal,
            "label": node.label,
            "team_a": names.get(node.team_a_id) if node.team_a_id else node.source_a_label,
            "team_b": names.get(node.team_b_id) if node.team_b_id else node.source_b_label,
            "winner_team_id": str(node.winner_team_id) if node.winner_team_id else None,
            "match_slug": slugs.get(node.match_id) if node.match_id else None,
            "scheduled_at": node.scheduled_at,
        }
        for node in sorted(tournament.bracket, key=lambda b: b.ordinal)
    ]


@router.get("/matches/{slug}/exists", include_in_schema=False)
async def match_exists(session: SessionDep, slug: str = Slug) -> dict[str, bool]:
    found = (
        await session.execute(
            select(Match.id).where(Match.public_slug == slug, Match.deleted_at.is_(None)).limit(1)
        )
    ).scalar_one_or_none()
    if found is None:
        raise NotFound("That link is not valid.", code="match_not_found")
    return {"exists": True}
