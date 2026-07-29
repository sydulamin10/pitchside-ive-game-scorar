"""Saved teams and rosters.

Teams are per-account address-book entries: a club scorer sets up their side once
and reuses it every week. Deletes are soft, because a team that has played a match
still has to render on that match's scorecard forever.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.models.team import Player, Team
from app.models.user import User
from app.schemas.team import PlayerCreate, PlayerUpdate, TeamCreate, TeamUpdate

MAX_TEAMS_PER_USER = 200
MAX_PLAYERS_PER_TEAM = 40


async def list_teams(session: AsyncSession, user: User) -> list[Team]:
    rows = await session.execute(
        select(Team)
        .where(Team.owner_user_id == user.id, Team.deleted_at.is_(None))
        .order_by(func.lower(Team.name))
    )
    return list(rows.unique().scalars())


async def get_team(session: AsyncSession, user: User, team_id: uuid.UUID) -> Team:
    team = (
        (
            await session.execute(
                select(Team).where(Team.id == team_id, Team.deleted_at.is_(None)).limit(1)
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if team is None:
        raise NotFound("That team does not exist.", code="team_not_found")
    if team.owner_user_id != user.id and not user.is_admin:
        raise Forbidden("That team belongs to another account.")
    return team


async def create_team(session: AsyncSession, user: User, payload: TeamCreate) -> Team:
    count = (
        await session.execute(
            select(func.count())
            .select_from(Team)
            .where(Team.owner_user_id == user.id, Team.deleted_at.is_(None))
        )
    ).scalar_one()
    if count >= MAX_TEAMS_PER_USER:
        raise Conflict(
            "You have reached the maximum number of saved teams.", code="team_limit_reached"
        )

    team = Team(
        owner_user_id=user.id,
        name=payload.name,
        short_name=payload.short_name,
        logo_url=payload.logo_url,
        primary_color=payload.primary_color,
        home_ground=payload.home_ground,
    )
    session.add(team)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict(
            f"You already have a team called “{payload.name}”.", code="team_name_taken"
        ) from exc

    seen: set[str] = set()
    for index, entry in enumerate(payload.players, start=1):
        key = entry.name.lower()
        if key in seen:
            raise Conflict(f"{entry.name} is listed twice in this roster.", code="duplicate_player")
        seen.add(key)
        session.add(_new_player(team.id, entry, default_order=index))
    await session.flush()
    return team


async def update_team(
    session: AsyncSession, user: User, team_id: uuid.UUID, payload: TeamUpdate
) -> Team:
    team = await get_team(session, user, team_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(team, field, value)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict("You already have a team with that name.", code="team_name_taken") from exc
    return team


async def delete_team(session: AsyncSession, user: User, team_id: uuid.UUID) -> None:
    team = await get_team(session, user, team_id)
    now = datetime.now(UTC)
    team.deleted_at = now
    for player in team.players:
        if player.deleted_at is None:
            player.deleted_at = now
    await session.flush()


# ------------------------------------------------------------------- roster


async def add_player(
    session: AsyncSession, user: User, team_id: uuid.UUID, payload: PlayerCreate
) -> Player:
    team = await get_team(session, user, team_id)
    active = team.active_players
    if len(active) >= MAX_PLAYERS_PER_TEAM:
        raise Conflict("This roster is full.", code="roster_full")
    if any(p.name.lower() == payload.name.lower() for p in active):
        raise Conflict(f"{payload.name} is already on this roster.", code="duplicate_player")
    order = max((p.sort_order for p in active), default=0) + 1
    player = _new_player(team.id, payload, default_order=order)
    session.add(player)
    team.players.append(player)
    await session.flush()
    return player


async def update_player(
    session: AsyncSession,
    user: User,
    team_id: uuid.UUID,
    player_id: uuid.UUID,
    payload: PlayerUpdate,
) -> Player:
    team = await get_team(session, user, team_id)
    player = next((p for p in team.players if p.id == player_id and p.deleted_at is None), None)
    if player is None:
        raise NotFound("That player is not on this roster.", code="player_not_found")

    data = payload.model_dump(exclude_unset=True)
    new_name = data.get("name")
    if new_name and any(
        p.id != player.id and p.name.lower() == new_name.lower() for p in team.active_players
    ):
        raise Conflict(f"{new_name} is already on this roster.", code="duplicate_player")
    for field, value in data.items():
        setattr(player, field, value)
    await session.flush()
    return player


async def delete_player(
    session: AsyncSession, user: User, team_id: uuid.UUID, player_id: uuid.UUID
) -> None:
    team = await get_team(session, user, team_id)
    player = next((p for p in team.players if p.id == player_id and p.deleted_at is None), None)
    if player is None:
        raise NotFound("That player is not on this roster.", code="player_not_found")
    # Soft delete keeps the name on every scorecard the player already appears in.
    player.deleted_at = datetime.now(UTC)
    await session.flush()


def _new_player(team_id: uuid.UUID, payload: PlayerCreate, *, default_order: int) -> Player:
    return Player(
        team_id=team_id,
        name=payload.name,
        role=payload.role,
        batting_hand=payload.batting_hand,
        bowling_style=payload.bowling_style,
        jersey_number=payload.jersey_number,
        sort_order=payload.sort_order if payload.sort_order is not None else default_order,
    )
