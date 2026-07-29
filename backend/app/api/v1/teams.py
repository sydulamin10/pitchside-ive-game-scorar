"""Saved teams and rosters."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, SessionDep
from app.core.rate_limit import write_rate_limit
from app.schemas.common import Message
from app.schemas.team import (
    PlayerCreate,
    PlayerOut,
    PlayerUpdate,
    TeamCreate,
    TeamOut,
    TeamUpdate,
)
from app.services import team_service

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut], summary="List my teams")
async def list_teams(session: SessionDep, user: CurrentUser) -> list[TeamOut]:
    teams = await team_service.list_teams(session, user)
    return [TeamOut.model_validate(team) for team in teams]


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
    return TeamOut.model_validate(team)


@router.get("/{team_id}", response_model=TeamOut, summary="Get one team")
async def get_team(team_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> TeamOut:
    team = await team_service.get_team(session, user, team_id)
    return TeamOut.model_validate(team)


@router.patch("/{team_id}", response_model=TeamOut, summary="Update a team")
async def update_team(
    team_id: uuid.UUID, payload: TeamUpdate, session: SessionDep, user: CurrentUser
) -> TeamOut:
    team = await team_service.update_team(session, user, team_id, payload)
    await session.commit()
    team = await team_service.get_team(session, user, team_id)
    return TeamOut.model_validate(team)


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
    return PlayerOut.model_validate(player)


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
    return PlayerOut.model_validate(player)


@router.delete("/{team_id}/players/{player_id}", response_model=Message, summary="Remove a player")
async def delete_player(
    team_id: uuid.UUID, player_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Message:
    await team_service.delete_player(session, user, team_id, player_id)
    await session.commit()
    return Message(message="Player removed from the roster.")
