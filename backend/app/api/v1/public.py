"""Public, unauthenticated read endpoints.

These serve the share links: the live scorecard, the broadcast overlay, the
points table, and the bracket. They are the highest-traffic part of the product,
so every response is served from the Redis projection when it is warm and carries
an ``ETag``/``Cache-Control`` pair so repeat viewers and CDNs are cheap.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.core.config import settings
from app.core.errors import NotFound
from app.core.rate_limit import public_rate_limit
from app.models.match import Match
from app.models.team import Team
from app.models.tournament import Tournament
from app.services import state_cache, tournament_service
from app.services.match_query import load_snapshot

router = APIRouter(prefix="/public", tags=["public"], dependencies=[Depends(public_rate_limit)])

Slug = Path(min_length=3, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$")

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
    return {
        "status": payload.get("status"),
        "state_version": payload.get("state_version"),
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
