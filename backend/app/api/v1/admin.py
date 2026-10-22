"""Administrator-only endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query
from pydantic import EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import AdminUser, PaginationDep, SessionDep
from app.core.config import settings
from app.core.errors import BadRequest
from app.models.enums import MatchStatus
from app.models.match import Innings, Match
from app.models.team import Team
from app.models.tournament import Tournament
from app.schemas.common import Message, Schema
from app.schemas.match import MatchListItem, OverlayDirectorUpdate
from app.schemas.settings import FacebookSettingsUpdate
from app.services import admin_stats, app_settings, email_service, match_service, overlay_director
from app.services.match_query import load_match

router = APIRouter(prefix="/admin", tags=["admin"])


class SupportEmailIn(Schema):
    to: EmailStr
    subject: str = Field(min_length=2, max_length=160)
    body: str = Field(min_length=2, max_length=4000)


@router.get("/overview", summary="Admin dashboard stats")
async def admin_overview(session: SessionDep, _user: AdminUser) -> dict[str, Any]:
    return await admin_stats.dashboard(session)


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


@router.get("/teams", summary="All teams (admin)")
async def admin_list_teams(
    session: SessionDep,
    _user: AdminUser,
    pagination: PaginationDep,
) -> list[dict[str, Any]]:
    teams = list(
        (
            await session.execute(
                select(Team)
                .options(joinedload(Team.owner), selectinload(Team.players))
                .where(Team.deleted_at.is_(None))
                .order_by(Team.created_at.desc())
                .limit(pagination.limit)
                .offset(pagination.offset)
            )
        )
        .unique()
        .scalars()
    )
    return [
        {
            "id": team.id,
            "name": team.name,
            "logo_url": team.logo_url,
            "home_ground": team.home_ground,
            "manager_name": team.manager_name or team.owner_label,
            "owner_name": team.owner.display_name if team.owner else None,
            "owner_email": team.owner.email if team.owner else None,
            "player_count": len(team.active_players),
            "public_slug": team.public_slug,
            "created_at": team.created_at,
        }
        for team in teams
    ]


@router.get("/tournaments", summary="All tournaments (admin)")
async def admin_list_tournaments(
    session: SessionDep,
    _user: AdminUser,
    pagination: PaginationDep,
) -> list[dict[str, Any]]:
    rows = list(
        (
            await session.execute(
                select(Tournament)
                .where(Tournament.deleted_at.is_(None))
                .order_by(Tournament.created_at.desc())
                .limit(pagination.limit)
                .offset(pagination.offset)
            )
        ).scalars()
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "public_slug": row.public_slug,
            "logo_url": row.logo_url,
            "tournament_format": row.tournament_format,
            "status": row.status,
            "venue": row.venue,
            "start_date": row.start_date,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.get("/settings", summary="Safe settings snapshot")
async def admin_settings(_user: AdminUser) -> dict[str, Any]:
    return {
        "website_name": settings.PROJECT_NAME,
        "public_web_url": settings.PUBLIC_WEB_URL,
        "email_verify_required": settings.EMAIL_VERIFY_REQUIRED,
        "auto_approve_registration": settings.AUTO_APPROVE_REGISTRATION,
        "smtp_configured": settings.smtp_configured,
        "smtp_host": settings.SMTP_HOST,
        "smtp_from": settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME,
        "currency": "USD",
    }


@router.post("/support/email", response_model=Message, summary="Email a user from admin")
async def admin_support_email(payload: SupportEmailIn, _user: AdminUser) -> Message:
    if not settings.smtp_configured:
        raise BadRequest("Email is not configured on this server.", code="smtp_not_configured")
    sent = await email_service.send_plain_email(
        to_email=str(payload.to),
        subject=payload.subject,
        text=payload.body,
    )
    if not sent:
        raise BadRequest("The email could not be sent. Try again shortly.", code="email_send_failed")
    return Message(message="Email sent.")
