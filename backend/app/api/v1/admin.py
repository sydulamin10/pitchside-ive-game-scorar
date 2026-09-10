"""Administrator-only endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import AdminUser, PaginationDep, SessionDep
from app.models.enums import MatchStatus
from app.models.match import Innings, Match
from app.schemas.match import MatchListItem, OverlayDirectorUpdate
from app.schemas.settings import FacebookSettingsUpdate
from app.services import app_settings, match_service, overlay_director
from app.services.match_query import load_match

router = APIRouter(prefix="/admin", tags=["admin"])


def _score_line(match: Match) -> str | None:
    parts: list[str] = []
    for innings in sorted(match.innings, key=lambda i: i.sequence):
        summary = innings.summary
        if summary is None:
            continue
        parts.append(f"{summary.total_runs}/{summary.total_wickets} ({summary.overs_text})")
    if not parts:
        return None
    return " v ".join(parts)


@router.get("/matches", response_model=list[MatchListItem], summary="All matches (admin)")
async def admin_list_matches(
    session: SessionDep,
    _user: AdminUser,
    pagination: PaginationDep,
    match_status: MatchStatus | None = Query(default=None, alias="status"),
) -> list[MatchListItem]:
    stmt = (
        select(Match)
        .options(
            joinedload(Match.team_a),
            joinedload(Match.team_b),
            selectinload(Match.innings).selectinload(Innings.summary),
        )
        .where(Match.deleted_at.is_(None))
        .order_by(Match.created_at.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
    )
    if match_status is not None:
        stmt = stmt.where(Match.status == match_status)
    matches = list((await session.execute(stmt)).unique().scalars())
    return [
        MatchListItem.model_validate(match_service.list_item_payload(m, _score_line(m)))
        for m in matches
    ]


@router.get("/settings/facebook", summary="Facebook Login app credentials")
async def admin_get_facebook_settings(
    session: SessionDep,
    _user: AdminUser,
) -> dict[str, Any]:
    return await app_settings.facebook_settings_public(session)


@router.put("/settings/facebook", summary="Save Facebook Login app credentials")
async def admin_put_facebook_settings(
    payload: FacebookSettingsUpdate,
    session: SessionDep,
    _user: AdminUser,
) -> dict[str, Any]:
    result = await app_settings.save_facebook_settings(
        session, app_id=payload.app_id, app_secret=payload.app_secret
    )
    await session.commit()
    return result


@router.patch("/matches/{match_id}/overlay", summary="Direct a live overlay (admin)")
async def admin_patch_overlay(
    match_id: uuid.UUID,
    payload: OverlayDirectorUpdate,
    session: SessionDep,
    _user: AdminUser,
) -> dict[str, Any]:
    match = await load_match(session, match_id=match_id)
    return await overlay_director.publish(session, match, payload.model_dump(exclude_unset=True))
