"""Tournament organisation: entries, fixtures, points table, bracket."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import CurrentUser, PaginationDep, SessionDep, authorise_match
from app.core.config import settings
from app.core.errors import NotFound
from app.core.rate_limit import write_rate_limit
from app.models.match import Match
from app.models.team import Team
from app.models.tournament import Tournament, TournamentGroup
from app.schemas.common import Message
from app.schemas.match import MatchListItem
from app.schemas.tournament import (
    BracketGenerate,
    BracketMatchOut,
    BracketSlotUpdate,
    FixturesCreate,
    GroupCreate,
    GroupOut,
    ParticipantOut,
    ParticipantsAdd,
    PointsAdjustment,
    RoundRobinGenerate,
    TournamentCreate,
    TournamentOut,
    TournamentUpdate,
)
from app.services import match_service, tournament_service

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


async def _out(session: AsyncSession, tournament: Tournament) -> TournamentOut:
    match_count = (
        await session.execute(
            select(func.count())
            .select_from(Match)
            .where(Match.tournament_id == tournament.id, Match.deleted_at.is_(None))
        )
    ).scalar_one()
    payload = TournamentOut.model_validate(tournament)
    payload.share_url = settings.public_tournament_url(tournament.public_slug)
    payload.team_count = len(tournament.participants)
    payload.match_count = match_count
    return payload


@router.get("", response_model=list[TournamentOut], summary="List my tournaments")
async def list_tournaments(
    session: SessionDep, user: CurrentUser, pagination: PaginationDep
) -> list[TournamentOut]:
    rows = await session.execute(
        select(Tournament)
        .options(selectinload(Tournament.groups), selectinload(Tournament.participants))
        .where(Tournament.created_by_user_id == user.id, Tournament.deleted_at.is_(None))
        .order_by(Tournament.created_at.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
    )
    return [await _out(session, t) for t in rows.unique().scalars()]


@router.post(
    "",
    response_model=TournamentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a tournament",
)
async def create_tournament(
    payload: TournamentCreate, session: SessionDep, user: CurrentUser
) -> TournamentOut:
    tournament = await tournament_service.create_tournament(session, user, payload)
    await session.commit()
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament.id)
    return await _out(session, tournament)


@router.get("/{tournament_id}", response_model=TournamentOut, summary="Get a tournament")
async def get_tournament(
    tournament_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> TournamentOut:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    return await _out(session, tournament)


@router.patch("/{tournament_id}", response_model=TournamentOut, summary="Update a tournament")
async def update_tournament(
    tournament_id: uuid.UUID,
    payload: TournamentUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> TournamentOut:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    await tournament_service.update_tournament(session, tournament, payload)
    await session.commit()
    return await _out(session, tournament)


@router.delete("/{tournament_id}", response_model=Message, summary="Delete a tournament")
async def delete_tournament(
    tournament_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Message:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    tournament.deleted_at = datetime.now(UTC)
    await session.commit()
    return Message(message="Tournament deleted. Its matches are still available individually.")


# ---------------------------------------------------------------------- groups


@router.post(
    "/{tournament_id}/groups",
    response_model=GroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a group",
)
async def add_group(
    tournament_id: uuid.UUID, payload: GroupCreate, session: SessionDep, user: CurrentUser
) -> GroupOut:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    ordinal = (
        payload.ordinal
        if payload.ordinal is not None
        else max((g.ordinal for g in tournament.groups), default=-1) + 1
    )
    group = TournamentGroup(tournament_id=tournament.id, name=payload.name, ordinal=ordinal)
    session.add(group)
    await session.commit()
    return GroupOut.model_validate(group)


# ---------------------------------------------------------------- participants


@router.get(
    "/{tournament_id}/participants",
    response_model=list[ParticipantOut],
    summary="Teams entered",
)
async def list_participants(
    tournament_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[ParticipantOut]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    return await _participants(session, tournament)


@router.post(
    "/{tournament_id}/participants",
    response_model=list[ParticipantOut],
    status_code=status.HTTP_201_CREATED,
    summary="Enter teams",
)
async def add_participants(
    tournament_id: uuid.UUID,
    payload: ParticipantsAdd,
    session: SessionDep,
    user: CurrentUser,
) -> list[ParticipantOut]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    await tournament_service.add_participants(session, user, tournament, payload.participants)
    await session.commit()
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    return await _participants(session, tournament)


@router.delete(
    "/{tournament_id}/participants/{team_id}", response_model=Message, summary="Withdraw a team"
)
async def remove_participant(
    tournament_id: uuid.UUID, team_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Message:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    await tournament_service.remove_participant(session, tournament, team_id)
    await session.commit()
    return Message(message="Team withdrawn.")


@router.post(
    "/{tournament_id}/points-adjustment",
    response_model=Message,
    summary="Dock or award points",
)
async def adjust_points(
    tournament_id: uuid.UUID,
    payload: PointsAdjustment,
    session: SessionDep,
    user: CurrentUser,
) -> Message:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    participant = next((p for p in tournament.participants if p.team_id == payload.team_id), None)
    if participant is None:
        raise NotFound("That team is not in this tournament.", code="participant_not_found")
    participant.points_adjustment = payload.points_adjustment
    participant.adjustment_note = payload.note
    await tournament_service.compute_and_store_standings(session, tournament)
    await session.commit()
    return Message(message="Points table updated.")


# -------------------------------------------------------------------- fixtures


@router.get("/{tournament_id}/matches", response_model=list[MatchListItem], summary="Fixtures")
async def list_fixtures(
    tournament_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[MatchListItem]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    rows = await session.execute(
        select(Match)
        .options(joinedload(Match.team_a), joinedload(Match.team_b))
        .where(Match.tournament_id == tournament.id, Match.deleted_at.is_(None))
        .order_by(Match.scheduled_at.asc().nulls_last(), Match.created_at.asc())
    )
    return [
        MatchListItem.model_validate(match_service.list_item_payload(m))
        for m in rows.unique().scalars()
    ]


@router.post(
    "/{tournament_id}/fixtures",
    response_model=list[MatchListItem],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create fixtures",
)
async def create_fixtures(
    tournament_id: uuid.UUID,
    payload: FixturesCreate,
    session: SessionDep,
    user: CurrentUser,
) -> list[MatchListItem]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    created = await tournament_service.create_fixtures(session, user, tournament, payload.fixtures)
    await session.commit()
    return [MatchListItem.model_validate(match_service.list_item_payload(m)) for m in created]


@router.post(
    "/{tournament_id}/fixtures/round-robin",
    response_model=list[MatchListItem],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Generate a round robin",
)
async def generate_round_robin(
    tournament_id: uuid.UUID,
    payload: RoundRobinGenerate,
    session: SessionDep,
    user: CurrentUser,
) -> list[MatchListItem]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    created = await tournament_service.generate_round_robin(session, user, tournament, payload)
    await session.commit()
    return [MatchListItem.model_validate(match_service.list_item_payload(m)) for m in created]


# ------------------------------------------------------------------- standings


@router.get("/{tournament_id}/standings", summary="Points table", response_model=None)
async def standings(
    tournament_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    result = await tournament_service.compute_and_store_standings(session, tournament)
    await session.commit()
    return result.to_dict(tournament)


# --------------------------------------------------------------------- bracket


@router.get(
    "/{tournament_id}/bracket", response_model=list[BracketMatchOut], summary="Knockout bracket"
)
async def bracket(
    tournament_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[BracketMatchOut]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    return await _bracket_out(session, tournament)


@router.post(
    "/{tournament_id}/bracket",
    response_model=list[BracketMatchOut],
    status_code=status.HTTP_201_CREATED,
    summary="Generate the bracket",
)
async def generate_bracket(
    tournament_id: uuid.UUID,
    payload: BracketGenerate,
    session: SessionDep,
    user: CurrentUser,
) -> list[BracketMatchOut]:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    await tournament_service.generate_bracket(session, tournament, payload)
    await session.commit()
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    return await _bracket_out(session, tournament)


@router.patch(
    "/{tournament_id}/bracket/{bracket_id}",
    response_model=BracketMatchOut,
    summary="Fill a bracket slot",
)
async def update_bracket_slot(
    tournament_id: uuid.UUID,
    bracket_id: uuid.UUID,
    payload: BracketSlotUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> BracketMatchOut:
    tournament = await tournament_service.load_tournament(session, tournament_id=tournament_id)
    tournament_service.require_owner(tournament, user)
    node = next((b for b in tournament.bracket if b.id == bracket_id), None)
    if node is None:
        raise NotFound("That bracket slot does not exist.", code="bracket_slot_not_found")

    if payload.match_id is not None:
        await authorise_match(session, payload.match_id, user, write=True)
        node = await tournament_service.link_bracket_match(
            session, tournament, bracket_id, payload.match_id
        )
    if payload.team_a_id is not None:
        node.team_a_id = payload.team_a_id
    if payload.team_b_id is not None:
        node.team_b_id = payload.team_b_id
    if payload.winner_team_id is not None:
        node.winner_team_id = payload.winner_team_id
    if payload.scheduled_at is not None:
        node.scheduled_at = payload.scheduled_at
    await session.commit()
    rows = await _bracket_out(session, tournament)
    return next(row for row in rows if row.id == node.id)


# --------------------------------------------------------------------- helpers


async def _participants(session: AsyncSession, tournament: Tournament) -> list[ParticipantOut]:
    team_ids = [p.team_id for p in tournament.participants]
    teams: dict[uuid.UUID, Team] = {}
    if team_ids:
        rows = await session.execute(select(Team).where(Team.id.in_(team_ids)))
        teams = {t.id: t for t in rows.unique().scalars()}
    group_names = {g.id: g.name for g in tournament.groups}
    out: list[ParticipantOut] = []
    for participant in tournament.participants:
        team = teams.get(participant.team_id)
        out.append(
            ParticipantOut(
                id=participant.id,
                team_id=participant.team_id,
                team_name=team.name if team else "Unknown team",
                short_name=team.display_short_name if team else None,
                logo_url=team.logo_url if team else None,
                group_id=participant.group_id,
                group_name=group_names.get(participant.group_id) if participant.group_id else None,
                seed=participant.seed,
                points_adjustment=participant.points_adjustment,
            )
        )
    out.sort(key=lambda p: ((p.group_name or ""), p.seed or 99, p.team_name))
    return out


async def _bracket_out(session: AsyncSession, tournament: Tournament) -> list[BracketMatchOut]:
    team_ids = {b.team_a_id for b in tournament.bracket if b.team_a_id} | {
        b.team_b_id for b in tournament.bracket if b.team_b_id
    }
    names: dict[uuid.UUID, str] = {}
    if team_ids:
        rows = await session.execute(select(Team.id, Team.name).where(Team.id.in_(team_ids)))
        names = {row.id: row.name for row in rows}

    match_ids = [b.match_id for b in tournament.bracket if b.match_id]
    slugs: dict[uuid.UUID, str] = {}
    summaries: dict[uuid.UUID, str | None] = {}
    if match_ids:
        rows = await session.execute(
            select(Match.id, Match.public_slug, Match.result_summary).where(Match.id.in_(match_ids))
        )
        for row in rows:
            slugs[row.id] = row.public_slug
            summaries[row.id] = row.result_summary

    return [
        BracketMatchOut(
            id=node.id,
            round=node.round,
            ordinal=node.ordinal,
            label=node.label,
            team_a_id=node.team_a_id,
            team_a_name=names.get(node.team_a_id) if node.team_a_id else None,
            team_b_id=node.team_b_id,
            team_b_name=names.get(node.team_b_id) if node.team_b_id else None,
            source_a_label=node.source_a_label,
            source_b_label=node.source_b_label,
            match_id=node.match_id,
            match_slug=slugs.get(node.match_id) if node.match_id else None,
            winner_team_id=node.winner_team_id,
            next_bracket_match_id=node.next_bracket_match_id,
            scheduled_at=node.scheduled_at,
            score_line=summaries.get(node.match_id) if node.match_id else None,
        )
        for node in sorted(tournament.bracket, key=lambda b: b.ordinal)
    ]
