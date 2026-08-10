"""CRUD for player awards (owner/manager)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models.awards import PlayerAward
from app.models.team import Player, Team
from app.models.user import User
from app.schemas.awards import AwardCreate, AwardUpdate
from app.services import membership_service


async def list_awards(session: AsyncSession, player_id: uuid.UUID) -> list[PlayerAward]:
    rows = await session.execute(
        select(PlayerAward)
        .where(PlayerAward.player_id == player_id)
        .order_by(PlayerAward.awarded_at.desc())
    )
    return list(rows.scalars())


async def create_award(
    session: AsyncSession,
    *,
    team: Team,
    user: User,
    player_id: uuid.UUID,
    payload: AwardCreate,
) -> PlayerAward:
    await membership_service.require_membership(
        session, team, user, roles=membership_service.MANAGE_ROLES
    )
    player = _find_player(team, player_id)
    award = PlayerAward(
        player_id=player.id,
        team_id=team.id,
        kind=payload.kind,
        title=payload.title,
        description=payload.description,
        awarded_at=payload.awarded_at or datetime.now(UTC),
        image_url=payload.image_url,
        created_by_user_id=user.id,
    )
    session.add(award)
    await session.flush()
    return award


async def update_award(
    session: AsyncSession,
    *,
    team: Team,
    user: User,
    player_id: uuid.UUID,
    award_id: uuid.UUID,
    payload: AwardUpdate,
) -> PlayerAward:
    await membership_service.require_membership(
        session, team, user, roles=membership_service.MANAGE_ROLES
    )
    _find_player(team, player_id)
    award = await _get_award(session, player_id, award_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(award, field, value)
    await session.flush()
    return award


async def delete_award(
    session: AsyncSession,
    *,
    team: Team,
    user: User,
    player_id: uuid.UUID,
    award_id: uuid.UUID,
) -> None:
    await membership_service.require_membership(
        session, team, user, roles=membership_service.MANAGE_ROLES
    )
    _find_player(team, player_id)
    award = await _get_award(session, player_id, award_id)
    await session.delete(award)
    await session.flush()


def _find_player(team: Team, player_id: uuid.UUID) -> Player:
    player = next((p for p in team.players if p.id == player_id and p.deleted_at is None), None)
    if player is None:
        raise NotFound("That player is not on this roster.", code="player_not_found")
    return player


async def _get_award(
    session: AsyncSession, player_id: uuid.UUID, award_id: uuid.UUID
) -> PlayerAward:
    award = (
        await session.execute(
            select(PlayerAward)
            .where(PlayerAward.id == award_id, PlayerAward.player_id == player_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if award is None:
        raise NotFound("That award was not found.", code="award_not_found")
    return award
