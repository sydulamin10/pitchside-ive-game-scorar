"""Saved teams, rosters, memberships, and awards."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, SessionDep
from app.core.rate_limit import write_rate_limit
from app.schemas.awards import AwardCreate, AwardOut, AwardUpdate
from app.schemas.common import Message
from app.schemas.membership import InviteCreate, MemberRoleUpdate, MembershipOut
from app.schemas.team import (
    PlayerCreate,
    PlayerOut,
    PlayerUpdate,
    TeamCreate,
    TeamOut,
    TeamUpdate,
)
from app.services import award_service, membership_service, team_service

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut], summary="List my teams")
async def list_teams(session: SessionDep, user: CurrentUser) -> list[TeamOut]:
    teams = await team_service.list_teams(session, user)
    return [team_service.enrich_team(team) for team in teams]


@router.post(
    "",
    response_model=TeamOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a team with an optional roster",
)
async def create_team(payload: TeamCreate, session: SessionDep, user: CurrentUser) -> TeamOut:
    team = await team_service.create_team(session, user, payload)
    await session.commit()
    team = await team_service.get_team(session, user, team.id)
    return team_service.enrich_team(team)


@router.get("/{team_id}", response_model=TeamOut, summary="Get one team")
async def get_team(team_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> TeamOut:
    team = await team_service.get_team(session, user, team_id)
    return team_service.enrich_team(team)


@router.patch("/{team_id}", response_model=TeamOut, summary="Update a team")
async def update_team(
    team_id: uuid.UUID, payload: TeamUpdate, session: SessionDep, user: CurrentUser
) -> TeamOut:
    team = await team_service.update_team(session, user, team_id, payload)
    await session.commit()
    team = await team_service.get_team(session, user, team_id)
    return team_service.enrich_team(team)


@router.delete("/{team_id}", response_model=Message, summary="Delete a team")
async def delete_team(team_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Message:
    await team_service.delete_team(session, user, team_id)
    await session.commit()
    return Message(message="Team deleted. Past scorecards are unaffected.")


@router.post(
    "/{team_id}/players",
    response_model=PlayerOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a player to the roster",
)
async def add_player(
    team_id: uuid.UUID, payload: PlayerCreate, session: SessionDep, user: CurrentUser
) -> PlayerOut:
    player = await team_service.add_player(session, user, team_id, payload)
    await session.commit()
    return team_service.enrich_player(player)


@router.patch("/{team_id}/players/{player_id}", response_model=PlayerOut, summary="Update a player")
async def update_player(
    team_id: uuid.UUID,
    player_id: uuid.UUID,
    payload: PlayerUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> PlayerOut:
    player = await team_service.update_player(session, user, team_id, player_id, payload)
    await session.commit()
    return team_service.enrich_player(player)


@router.delete("/{team_id}/players/{player_id}", response_model=Message, summary="Remove a player")
async def delete_player(
    team_id: uuid.UUID, player_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Message:
    await team_service.delete_player(session, user, team_id, player_id)
    await session.commit()
    return Message(message="Player removed from the roster.")


# ------------------------------------------------------------------- awards


@router.get(
    "/{team_id}/players/{player_id}/awards",
    response_model=list[AwardOut],
    summary="List player awards",
)
async def list_awards(
    team_id: uuid.UUID, player_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[AwardOut]:
    await team_service.get_team(session, user, team_id)
    awards = await award_service.list_awards(session, player_id)
    return [AwardOut.model_validate(a) for a in awards]


@router.post(
    "/{team_id}/players/{player_id}/awards",
    response_model=AwardOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Add a player award",
)
async def create_award(
    team_id: uuid.UUID,
    player_id: uuid.UUID,
    payload: AwardCreate,
    session: SessionDep,
    user: CurrentUser,
) -> AwardOut:
    team = await team_service.get_team_for_manage(session, user, team_id)
    award = await award_service.create_award(
        session, team=team, user=user, player_id=player_id, payload=payload
    )
    await session.commit()
    return AwardOut.model_validate(award)


@router.patch(
    "/{team_id}/players/{player_id}/awards/{award_id}",
    response_model=AwardOut,
    summary="Update a player award",
)
async def update_award(
    team_id: uuid.UUID,
    player_id: uuid.UUID,
    award_id: uuid.UUID,
    payload: AwardUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> AwardOut:
    team = await team_service.get_team_for_manage(session, user, team_id)
    award = await award_service.update_award(
        session,
        team=team,
        user=user,
        player_id=player_id,
        award_id=award_id,
        payload=payload,
    )
    await session.commit()
    return AwardOut.model_validate(award)


@router.delete(
    "/{team_id}/players/{player_id}/awards/{award_id}",
    response_model=Message,
    summary="Delete a player award",
)
async def delete_award(
    team_id: uuid.UUID,
    player_id: uuid.UUID,
    award_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> Message:
    team = await team_service.get_team_for_manage(session, user, team_id)
    await award_service.delete_award(
        session, team=team, user=user, player_id=player_id, award_id=award_id
    )
    await session.commit()
    return Message(message="Award removed.")


# --------------------------------------------------------------- membership


@router.get(
    "/{team_id}/members",
    response_model=list[MembershipOut],
    summary="List team members",
)
async def list_members(
    team_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[MembershipOut]:
    rows = await membership_service.list_members(session, user, team_id)
    out: list[MembershipOut] = []
    for r in rows:
        item = MembershipOut.model_validate(r)
        if r.status.value != "invited":
            item.invite_token = None
        out.append(item)
    return out


@router.post(
    "/{team_id}/invites",
    response_model=MembershipOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Invite a member by email",
)
async def create_invite(
    team_id: uuid.UUID,
    payload: InviteCreate,
    session: SessionDep,
    user: CurrentUser,
) -> MembershipOut:
    row = await membership_service.create_invite(session, user, team_id, payload)
    await session.commit()
    out = MembershipOut.model_validate(row)
    # Token returned once so the inviter can share it.
    return out


@router.post(
    "/invites/{token}/accept",
    response_model=MembershipOut,
    summary="Accept a team invite by token",
)
async def accept_invite(
    token: str, session: SessionDep, user: CurrentUser
) -> MembershipOut:
    row = await membership_service.accept_invite(session, user, token)
    await session.commit()
    out = MembershipOut.model_validate(row)
    out.invite_token = None
    return out


@router.post(
    "/{team_id}/join-requests",
    response_model=MembershipOut,
    status_code=status.HTTP_201_CREATED,
    summary="Request to join a team",
)
async def create_join_request(
    team_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> MembershipOut:
    row = await membership_service.create_join_request(session, user, team_id)
    await session.commit()
    out = MembershipOut.model_validate(row)
    out.invite_token = None
    return out


@router.post(
    "/{team_id}/join-requests/{member_id}/accept",
    response_model=MembershipOut,
    summary="Accept a join request",
)
async def accept_join_request(
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> MembershipOut:
    row = await membership_service.accept_join_request(session, user, team_id, member_id)
    await session.commit()
    out = MembershipOut.model_validate(row)
    out.invite_token = None
    return out


@router.post(
    "/{team_id}/join-requests/{member_id}/reject",
    response_model=MembershipOut,
    summary="Reject a join request",
)
async def reject_join_request(
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> MembershipOut:
    row = await membership_service.reject_join_request(session, user, team_id, member_id)
    await session.commit()
    out = MembershipOut.model_validate(row)
    out.invite_token = None
    return out


@router.patch(
    "/{team_id}/members/{member_id}",
    response_model=MembershipOut,
    summary="Update a member role",
)
async def update_member_role(
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    payload: MemberRoleUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> MembershipOut:
    row = await membership_service.update_member_role(
        session, user, team_id, member_id, payload
    )
    await session.commit()
    out = MembershipOut.model_validate(row)
    out.invite_token = None
    return out


@router.delete(
    "/{team_id}/members/{member_id}",
    response_model=Message,
    summary="Remove a team member",
)
async def remove_member(
    team_id: uuid.UUID,
    member_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> Message:
    await membership_service.remove_member(session, user, team_id, member_id)
    await session.commit()
    return Message(message="Member removed.")
