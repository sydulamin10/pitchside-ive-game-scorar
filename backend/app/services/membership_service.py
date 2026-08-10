"""Team membership invites, join requests, and role management."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models.enums import (
    TEAM_MANAGE_ROLES,
    MembershipStatus,
    TeamMembershipRole,
)
from app.models.membership import TeamMembership
from app.models.team import Team
from app.models.user import User
from app.schemas.membership import InviteCreate, MemberRoleUpdate

READ_ROLES: frozenset[TeamMembershipRole] = frozenset(TeamMembershipRole)
MANAGE_ROLES: frozenset[TeamMembershipRole] = TEAM_MANAGE_ROLES
ROSTER_ROLES: frozenset[TeamMembershipRole] = frozenset(
    {
        TeamMembershipRole.OWNER,
        TeamMembershipRole.MANAGER,
        TeamMembershipRole.COACH,
        TeamMembershipRole.CAPTAIN,
    }
)


async def team_ids_for_user(session: AsyncSession, user: User) -> list[uuid.UUID]:
    rows = await session.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.user_id == user.id,
            TeamMembership.status == MembershipStatus.ACTIVE,
        )
    )
    ids = {row for row in rows.scalars()}
    owned = await session.execute(
        select(Team.id).where(Team.owner_user_id == user.id, Team.deleted_at.is_(None))
    )
    ids.update(owned.scalars())
    return list(ids)


async def require_membership(
    session: AsyncSession,
    team: Team,
    user: User,
    *,
    roles: frozenset[TeamMembershipRole] | None = None,
) -> TeamMembership | None:
    if user.is_admin:
        return None
    if team.owner_user_id == user.id:
        if roles is not None and TeamMembershipRole.OWNER not in roles:
            # Owner always satisfies manage/read; only fail if OWNER excluded deliberately.
            if not roles & TEAM_MANAGE_ROLES and TeamMembershipRole.OWNER not in roles:
                pass
        return None

    row = (
        await session.execute(
            select(TeamMembership)
            .where(
                TeamMembership.team_id == team.id,
                TeamMembership.user_id == user.id,
                TeamMembership.status == MembershipStatus.ACTIVE,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise Forbidden("That team belongs to another account.")
    if roles is not None and row.role not in roles:
        raise Forbidden("You do not have permission to do that on this team.")
    return row


async def create_owner_membership(
    session: AsyncSession, team: Team, user: User
) -> TeamMembership:
    row = TeamMembership(
        team_id=team.id,
        user_id=user.id,
        role=TeamMembershipRole.OWNER,
        status=MembershipStatus.ACTIVE,
        invited_email=user.email.lower() if user.email else None,
    )
    session.add(row)
    await session.flush()
    return row


async def list_members(session: AsyncSession, user: User, team_id: uuid.UUID) -> list[TeamMembership]:
    team = await _load_team(session, team_id)
    await require_membership(session, team, user, roles=READ_ROLES)
    rows = await session.execute(
        select(TeamMembership)
        .where(TeamMembership.team_id == team_id)
        .order_by(TeamMembership.created_at.asc())
    )
    return list(rows.scalars())


async def create_invite(
    session: AsyncSession, user: User, team_id: uuid.UUID, payload: InviteCreate
) -> TeamMembership:
    team = await _load_team(session, team_id)
    await require_membership(session, team, user, roles=MANAGE_ROLES)
    if payload.role is TeamMembershipRole.OWNER:
        raise BadRequest("Cannot invite someone as owner.", code="invalid_role")

    email = str(payload.email).lower().strip()
    existing = (
        await session.execute(
            select(TeamMembership)
            .where(
                TeamMembership.team_id == team_id,
                TeamMembership.invited_email == email,
                TeamMembership.status.in_(
                    (MembershipStatus.ACTIVE, MembershipStatus.INVITED, MembershipStatus.REQUESTED)
                ),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise Conflict("That person already has a membership on this team.", code="already_member")

    row = TeamMembership(
        team_id=team_id,
        user_id=None,
        role=payload.role,
        status=MembershipStatus.INVITED,
        invited_email=email,
        invite_token=secrets.token_urlsafe(24),
        invited_by_user_id=user.id,
    )
    session.add(row)
    await session.flush()
    return row


async def accept_invite(session: AsyncSession, user: User, token: str) -> TeamMembership:
    row = (
        await session.execute(
            select(TeamMembership)
            .where(
                TeamMembership.invite_token == token,
                TeamMembership.status == MembershipStatus.INVITED,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("That invite is invalid or already used.", code="invite_not_found")

    # Clear any prior left/rejected row for this user+team to satisfy unique(user_id, team_id).
    prior = (
        await session.execute(
            select(TeamMembership)
            .where(
                TeamMembership.team_id == row.team_id,
                TeamMembership.user_id == user.id,
                TeamMembership.id != row.id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if prior is not None:
        if prior.status is MembershipStatus.ACTIVE:
            raise Conflict("You are already a member of this team.", code="already_member")
        await session.delete(prior)
        await session.flush()

    row.user_id = user.id
    row.status = MembershipStatus.ACTIVE
    row.responded_at = datetime.now(UTC)
    row.invite_token = None
    await session.flush()
    return row


async def create_join_request(
    session: AsyncSession, user: User, team_id: uuid.UUID
) -> TeamMembership:
    await _load_team(session, team_id)
    existing = (
        await session.execute(
            select(TeamMembership)
            .where(TeamMembership.team_id == team_id, TeamMembership.user_id == user.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status is MembershipStatus.ACTIVE:
            raise Conflict("You are already a member of this team.", code="already_member")
        if existing.status is MembershipStatus.REQUESTED:
            raise Conflict("You already have a pending join request.", code="request_pending")
        if existing.status is MembershipStatus.INVITED:
            raise Conflict("You already have an invite for this team.", code="invite_pending")
        existing.status = MembershipStatus.REQUESTED
        existing.role = TeamMembershipRole.PLAYER
        existing.responded_at = None
        await session.flush()
        return existing

    row = TeamMembership(
        team_id=team_id,
        user_id=user.id,
        role=TeamMembershipRole.PLAYER,
        status=MembershipStatus.REQUESTED,
    )
    session.add(row)
    await session.flush()
    return row


async def accept_join_request(
    session: AsyncSession, user: User, team_id: uuid.UUID, member_id: uuid.UUID
) -> TeamMembership:
    team = await _load_team(session, team_id)
    await require_membership(session, team, user, roles=MANAGE_ROLES)
    row = await _get_member(session, team_id, member_id)
    if row.status is not MembershipStatus.REQUESTED:
        raise BadRequest("That membership is not a pending join request.", code="not_a_request")
    row.status = MembershipStatus.ACTIVE
    row.responded_at = datetime.now(UTC)
    await session.flush()
    return row


async def reject_join_request(
    session: AsyncSession, user: User, team_id: uuid.UUID, member_id: uuid.UUID
) -> TeamMembership:
    team = await _load_team(session, team_id)
    await require_membership(session, team, user, roles=MANAGE_ROLES)
    row = await _get_member(session, team_id, member_id)
    if row.status is not MembershipStatus.REQUESTED:
        raise BadRequest("That membership is not a pending join request.", code="not_a_request")
    row.status = MembershipStatus.REJECTED
    row.responded_at = datetime.now(UTC)
    await session.flush()
    return row


async def update_member_role(
    session: AsyncSession,
    user: User,
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    payload: MemberRoleUpdate,
) -> TeamMembership:
    team = await _load_team(session, team_id)
    await require_membership(session, team, user, roles=MANAGE_ROLES)
    row = await _get_member(session, team_id, member_id)
    if row.status is not MembershipStatus.ACTIVE:
        raise BadRequest("Only active members can change role.", code="member_not_active")
    if row.role is TeamMembershipRole.OWNER:
        raise Forbidden("Cannot demote the team owner via membership role.", code="owner_locked")
    if payload.role is TeamMembershipRole.OWNER:
        raise BadRequest("Cannot promote to owner via this endpoint.", code="invalid_role")
    row.role = payload.role
    await session.flush()
    return row


async def remove_member(
    session: AsyncSession, user: User, team_id: uuid.UUID, member_id: uuid.UUID
) -> None:
    team = await _load_team(session, team_id)
    await require_membership(session, team, user, roles=MANAGE_ROLES)
    row = await _get_member(session, team_id, member_id)
    if row.role is TeamMembershipRole.OWNER and row.status is MembershipStatus.ACTIVE:
        raise Forbidden("Cannot remove the team owner.", code="owner_locked")
    if row.status is MembershipStatus.ACTIVE:
        row.status = MembershipStatus.LEFT
        row.responded_at = datetime.now(UTC)
    else:
        await session.delete(row)
    await session.flush()


def membership_to_out(row: TeamMembership, *, include_token: bool = False) -> dict:
    from app.schemas.membership import MembershipOut

    data = MembershipOut.model_validate(row)
    if not include_token:
        data.invite_token = None
    return data


async def _load_team(session: AsyncSession, team_id: uuid.UUID) -> Team:
    team = (
        await session.execute(
            select(Team).where(Team.id == team_id, Team.deleted_at.is_(None)).limit(1)
        )
    ).unique().scalar_one_or_none()
    if team is None:
        raise NotFound("That team does not exist.", code="team_not_found")
    return team


async def _get_member(
    session: AsyncSession, team_id: uuid.UUID, member_id: uuid.UUID
) -> TeamMembership:
    row = (
        await session.execute(
            select(TeamMembership)
            .where(TeamMembership.id == member_id, TeamMembership.team_id == team_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFound("That membership was not found.", code="member_not_found")
    return row
