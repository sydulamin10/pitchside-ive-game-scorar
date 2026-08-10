"""Saved teams and rosters.

Teams are per-account address-book entries: a club scorer sets up their side once
and reuses it every week. Deletes are soft, because a team that has played a match
still has to render on that match's scorecard forever.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import Conflict, NotFound
from app.models.enums import TeamMembershipRole
from app.models.team import Player, Team
from app.models.user import User
from app.schemas.team import (
    PlayerCreate,
    PlayerOut,
    PlayerPublicOut,
    PlayerUpdate,
    TeamCreate,
    TeamOut,
    TeamPublicBadge,
    TeamPublicOut,
    TeamUpdate,
)
from app.services import membership_service
from app.utils.slugs import build_public_slug

MAX_TEAMS_PER_USER = 200
MAX_PLAYERS_PER_TEAM = 40


def enrich_player(player: Player, *, team: Team | None = None) -> PlayerOut:
    out = PlayerOut.model_validate(player)
    if player.public_slug:
        out.profile_url = settings.public_player_url(player.public_slug)
    return out


def enrich_team(team: Team) -> TeamOut:
    out = TeamOut.model_validate(team)
    if team.public_slug:
        out.profile_url = settings.public_club_url(team.public_slug)
    out.players = [enrich_player(p, team=team) for p in team.active_players]
    return out


def enrich_public_team(team: Team) -> TeamPublicOut:
    badge_url = settings.public_club_url(team.public_slug) if team.public_slug else None
    players = []
    for player in team.active_players:
        row = enrich_player(player, team=team)
        players.append(row)
    return TeamPublicOut(
        id=team.id,
        name=team.name,
        short_name=team.short_name,
        public_slug=team.public_slug,
        logo_url=team.logo_url,
        cover_url=team.cover_url,
        primary_color=team.primary_color,
        secondary_color=team.secondary_color,
        home_ground=team.home_ground,
        founded_year=team.founded_year,
        description=team.description,
        coach_name=team.coach_name,
        manager_name=team.manager_name,
        owner_label=team.owner_label,
        sponsor=team.sponsor,
        social_links=team.social_links or {},
        profile_url=badge_url,
        players=players,
    )


def enrich_public_player(player: Player, team: Team) -> PlayerPublicOut:
    team_badge = TeamPublicBadge(
        id=team.id,
        name=team.name,
        short_name=team.short_name,
        public_slug=team.public_slug,
        logo_url=team.logo_url,
        primary_color=team.primary_color,
        secondary_color=team.secondary_color,
        profile_url=settings.public_club_url(team.public_slug) if team.public_slug else None,
    )
    return PlayerPublicOut(
        id=player.id,
        name=player.name,
        nickname=player.nickname,
        public_slug=player.public_slug,
        role=player.role,
        batting_hand=player.batting_hand,
        bowling_style=player.bowling_style,
        jersey_number=player.jersey_number,
        photo_url=player.photo_url,
        cover_url=player.cover_url,
        date_of_birth=player.date_of_birth,
        nationality=player.nationality,
        location=player.location,
        height_cm=player.height_cm,
        weight_kg=player.weight_kg,
        bio=player.bio,
        career_summary=player.career_summary,
        social_links=player.social_links or {},
        profile_url=settings.public_player_url(player.public_slug) if player.public_slug else None,
        team=team_badge,
    )


async def list_teams(session: AsyncSession, user: User) -> list[Team]:
    team_ids = await membership_service.team_ids_for_user(session, user)
    if not team_ids:
        return []
    rows = await session.execute(
        select(Team)
        .where(Team.id.in_(team_ids), Team.deleted_at.is_(None))
        .order_by(func.lower(Team.name))
    )
    return list(rows.unique().scalars())


async def get_team(
    session: AsyncSession,
    user: User,
    team_id: uuid.UUID,
    *,
    roles: frozenset[TeamMembershipRole] | None = None,
) -> Team:
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
    await membership_service.require_membership(
        session, team, user, roles=roles or membership_service.READ_ROLES
    )
    return team


async def get_team_for_manage(session: AsyncSession, user: User, team_id: uuid.UUID) -> Team:
    return await get_team(session, user, team_id, roles=membership_service.MANAGE_ROLES)


async def get_team_for_roster(session: AsyncSession, user: User, team_id: uuid.UUID) -> Team:
    return await get_team(session, user, team_id, roles=membership_service.ROSTER_ROLES)

async def get_public_team(session: AsyncSession, id_or_slug: str) -> Team:
    stmt = select(Team).where(Team.deleted_at.is_(None))
    try:
        team_id = uuid.UUID(id_or_slug)
        stmt = stmt.where(or_(Team.id == team_id, Team.public_slug == id_or_slug))
    except ValueError:
        stmt = stmt.where(Team.public_slug == id_or_slug)
    team = (await session.execute(stmt.limit(1))).unique().scalar_one_or_none()
    if team is None or not team.public_slug:
        raise NotFound("That club profile was not found.", code="team_not_found")
    return team


async def get_public_player(session: AsyncSession, id_or_slug: str) -> tuple[Player, Team]:
    stmt = (
        select(Player)
        .join(Team, Team.id == Player.team_id)
        .where(Player.deleted_at.is_(None), Team.deleted_at.is_(None))
    )
    try:
        player_id = uuid.UUID(id_or_slug)
        stmt = stmt.where(or_(Player.id == player_id, Player.public_slug == id_or_slug))
    except ValueError:
        stmt = stmt.where(Player.public_slug == id_or_slug)
    player = (await session.execute(stmt.limit(1))).unique().scalar_one_or_none()
    if player is None or not player.public_slug:
        raise NotFound("That player profile was not found.", code="player_not_found")
    team = (
        (
            await session.execute(
                select(Team).where(Team.id == player.team_id, Team.deleted_at.is_(None)).limit(1)
            )
        )
        .unique()
        .scalar_one()
    )
    return player, team


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

    data = payload.model_dump(exclude={"players"})
    social = data.pop("social_links", None) or {}
    team = Team(
        owner_user_id=user.id,
        public_slug=build_public_slug(payload.name, payload.short_name),
        social_links=social,
        **{k: v for k, v in data.items() if k != "social_links"},
    )
    session.add(team)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict(
            f"You already have a team called “{payload.name}”.", code="team_name_taken"
        ) from exc

    await membership_service.create_owner_membership(session, team, user)

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
    team = await get_team_for_manage(session, user, team_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(team, field, value)
    if not team.public_slug:
        team.public_slug = build_public_slug(team.name, team.short_name)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict("You already have a team with that name.", code="team_name_taken") from exc
    return team


async def delete_team(session: AsyncSession, user: User, team_id: uuid.UUID) -> None:
    team = await get_team(session, user, team_id, roles=frozenset({TeamMembershipRole.OWNER}))
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
    team = await get_team_for_roster(session, user, team_id)
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
    team = await get_team_for_roster(session, user, team_id)
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
    if not player.public_slug:
        player.public_slug = build_public_slug(player.name, team.short_name or team.name)
    await session.flush()
    return player


async def delete_player(
    session: AsyncSession, user: User, team_id: uuid.UUID, player_id: uuid.UUID
) -> None:
    team = await get_team_for_roster(session, user, team_id)
    player = next((p for p in team.players if p.id == player_id and p.deleted_at is None), None)
    if player is None:
        raise NotFound("That player is not on this roster.", code="player_not_found")
    # Soft delete keeps the name on every scorecard the player already appears in.
    player.deleted_at = datetime.now(UTC)
    await session.flush()


def _new_player(team_id: uuid.UUID, payload: PlayerCreate, *, default_order: int) -> Player:
    data = payload.model_dump()
    social = data.pop("social_links", None) or {}
    sort_order = data.pop("sort_order", None)
    return Player(
        team_id=team_id,
        public_slug=build_public_slug(payload.name),
        social_links=social,
        sort_order=sort_order if sort_order is not None else default_order,
        **data,
    )
