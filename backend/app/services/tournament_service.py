"""Tournaments: fixtures, points table, and the knockout bracket.

The points table is a projection, exactly like the innings summary: it is derived
from completed matches and rewritten whenever a result lands. That is why fixing
a mis-recorded ball in a match played last week silently corrects the standings
and, if the winner changes, the bracket too.
"""

from __future__ import annotations

import itertools
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import settings
from app.core.errors import Conflict, Forbidden, NotFound, RuleViolation
from app.core.logging import get_logger
from app.models.enums import (
    AuditAction,
    BracketRound,
    MatchResultType,
    MatchStatus,
    TournamentFormat,
    TournamentStatus,
)
from app.models.match import Innings, Match
from app.models.team import Team
from app.models.tournament import (
    BracketMatch,
    Tournament,
    TournamentGroup,
    TournamentStandingSnapshot,
    TournamentTeam,
)
from app.models.user import User
from app.schemas.tournament import (
    BracketGenerate,
    FixtureInput,
    ParticipantInput,
    RoundRobinGenerate,
    TournamentCreate,
    TournamentUpdate,
)
from app.scoring import PointsConfig, StandingRow, TeamMatchRecord, compute_standings
from app.services import audit_service, state_cache
from app.utils.slugs import build_public_slug

logger = get_logger(__name__)

_ROUND_BY_SIZE = {
    8: BracketRound.ROUND_OF_16,
    4: BracketRound.QUARTER_FINAL,
    2: BracketRound.SEMI_FINAL,
    1: BracketRound.FINAL,
}


@dataclass(slots=True)
class StandingsResult:
    rows: list[StandingRow]
    groups: list[TournamentGroup]

    def to_dict(self, tournament: Tournament) -> dict[str, Any]:
        return {
            "tournament": {
                "id": str(tournament.id),
                "name": tournament.name,
                "slug": tournament.public_slug,
                "format": tournament.tournament_format.value,
                "status": tournament.status.value,
                "use_net_run_rate": tournament.use_net_run_rate,
                "teams_advancing_per_group": tournament.teams_advancing_per_group,
                "share_url": settings.public_tournament_url(tournament.public_slug),
            },
            "groups": [
                {"id": str(g.id), "name": g.name, "ordinal": g.ordinal} for g in self.groups
            ],
            "standings": [row.to_dict() for row in self.rows],
            "computed_at": datetime.now(UTC).isoformat(),
        }


# --------------------------------------------------------------------- loading


async def load_tournament(
    session: AsyncSession, *, tournament_id: uuid.UUID | None = None, slug: str | None = None
) -> Tournament:
    stmt = (
        select(Tournament)
        .options(
            selectinload(Tournament.groups),
            selectinload(Tournament.participants),
            selectinload(Tournament.bracket),
        )
        .where(Tournament.deleted_at.is_(None))
        .limit(1)
    )
    stmt = (
        stmt.where(Tournament.id == tournament_id)
        if tournament_id
        else stmt.where(Tournament.public_slug == slug)
    )
    tournament = (await session.execute(stmt)).unique().scalar_one_or_none()
    if tournament is None:
        raise NotFound("That tournament does not exist.", code="tournament_not_found")
    return tournament


def require_owner(tournament: Tournament, user: User) -> None:
    if tournament.created_by_user_id != user.id and not user.is_admin:
        raise Forbidden("Only the organiser can change this tournament.")


# -------------------------------------------------------------------- creation


async def create_tournament(
    session: AsyncSession, user: User, payload: TournamentCreate
) -> Tournament:
    tournament = Tournament(
        public_slug=build_public_slug(payload.name),
        created_by_user_id=user.id,
        name=payload.name,
        description=payload.description,
        tournament_format=payload.tournament_format,
        venue=payload.venue,
        logo_url=payload.logo_url,
        default_overs_limit=payload.default_overs_limit,
        default_max_overs_per_bowler=payload.default_max_overs_per_bowler,
        points_per_win=payload.points.points_per_win,
        points_per_tie=payload.points.points_per_tie,
        points_per_loss=payload.points.points_per_loss,
        points_per_no_result=payload.points.points_per_no_result,
        use_net_run_rate=payload.points.use_net_run_rate,
        teams_advancing_per_group=payload.teams_advancing_per_group,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=TournamentStatus.DRAFT,
    )
    session.add(tournament)
    # Nothing can lazy-load on an async session, and a brand new tournament has
    # no children by definition, so mark the collections as loaded-and-empty.
    for collection in ("groups", "participants", "bracket"):
        set_committed_value(tournament, collection, [])
    await session.flush()

    for index, name in enumerate(payload.groups):
        group = TournamentGroup(tournament_id=tournament.id, name=name, ordinal=index)
        session.add(group)
        tournament.groups.append(group)
    await session.flush()

    if payload.team_ids:
        await add_participants(
            session,
            user,
            tournament,
            [ParticipantInput(team_id=team_id) for team_id in payload.team_ids],
        )

    await audit_service.record(
        session,
        AuditAction.TOURNAMENT_CREATED,
        actor_user_id=user.id,
        entity_type="tournament",
        entity_id=tournament.id,
        context={"name": tournament.name},
    )
    return tournament


async def update_tournament(
    session: AsyncSession, tournament: Tournament, payload: TournamentUpdate
) -> Tournament:
    simple = (
        "name",
        "description",
        "venue",
        "logo_url",
        "status",
        "default_overs_limit",
        "default_max_overs_per_bowler",
        "teams_advancing_per_group",
        "start_date",
        "end_date",
    )
    for attribute in simple:
        value = getattr(payload, attribute)
        if value is not None:
            setattr(tournament, attribute, value)
    if payload.points is not None:
        tournament.points_per_win = payload.points.points_per_win
        tournament.points_per_tie = payload.points.points_per_tie
        tournament.points_per_loss = payload.points.points_per_loss
        tournament.points_per_no_result = payload.points.points_per_no_result
        tournament.use_net_run_rate = payload.points.use_net_run_rate
    if tournament.status is TournamentStatus.COMPLETED and tournament.completed_at is None:
        tournament.completed_at = datetime.now(UTC)
    return tournament


async def add_participants(
    session: AsyncSession,
    user: User,
    tournament: Tournament,
    participants: list[ParticipantInput],
) -> list[TournamentTeam]:
    existing = {tt.team_id for tt in tournament.participants}
    group_ids = {g.id for g in tournament.groups}
    added: list[TournamentTeam] = []

    for entry in participants:
        if entry.team_id in existing:
            continue
        team = (
            await session.execute(
                select(Team).where(Team.id == entry.team_id, Team.deleted_at.is_(None)).limit(1)
            )
        ).scalar_one_or_none()
        if team is None:
            raise NotFound(
                "That team does not exist.",
                code="team_not_found",
                details={"team_id": str(entry.team_id)},
            )
        if team.owner_user_id != user.id and not user.is_admin:
            raise Forbidden("You can only enter teams from your own account.")
        if entry.group_id is not None and entry.group_id not in group_ids:
            raise NotFound("That group is not part of this tournament.", code="group_not_found")

        participant = TournamentTeam(
            tournament_id=tournament.id,
            team_id=entry.team_id,
            group_id=entry.group_id,
            seed=entry.seed,
        )
        session.add(participant)
        tournament.participants.append(participant)
        added.append(participant)
        existing.add(entry.team_id)

    await session.flush()
    return added


async def remove_participant(
    session: AsyncSession, tournament: Tournament, team_id: uuid.UUID
) -> None:
    participant = next((tt for tt in tournament.participants if tt.team_id == team_id), None)
    if participant is None:
        raise NotFound("That team is not in this tournament.", code="participant_not_found")
    played = (
        await session.execute(
            select(func.count())
            .select_from(Match)
            .where(
                Match.tournament_id == tournament.id,
                Match.deleted_at.is_(None),
                (Match.team_a_id == team_id) | (Match.team_b_id == team_id),
            )
        )
    ).scalar_one()
    if played:
        raise Conflict(
            "That team already has fixtures in this tournament. Delete them first.",
            code="participant_has_fixtures",
        )
    await session.delete(participant)
    tournament.participants.remove(participant)


# -------------------------------------------------------------------- fixtures


async def create_fixtures(
    session: AsyncSession,
    user: User,
    tournament: Tournament,
    fixtures: list[FixtureInput],
) -> list[Match]:
    """Create fixtures. Each squad is filled from the saved roster by the match service."""
    from app.schemas.match import MatchCreate, MatchRulesInput, MatchTeamInput
    from app.services import match_service

    entered = {tt.team_id for tt in tournament.participants}
    created: list[Match] = []

    for fixture in fixtures:
        for team_id in (fixture.team_a_id, fixture.team_b_id):
            if team_id not in entered:
                raise RuleViolation(
                    "Both teams must be entered in the tournament before a fixture is created.",
                    code="team_not_entered",
                    details={"team_id": str(team_id)},
                )
        payload = MatchCreate(
            title=None,
            venue=fixture.venue or tournament.venue,
            match_format=fixture.match_format or _default_format(tournament),
            rules=MatchRulesInput(
                overs_limit=fixture.overs_limit or tournament.default_overs_limit,
                max_overs_per_bowler=tournament.default_max_overs_per_bowler,
            ),
            team_a=MatchTeamInput(team_id=fixture.team_a_id),
            team_b=MatchTeamInput(team_id=fixture.team_b_id),
            scheduled_at=fixture.scheduled_at,
            tournament_id=tournament.id,
            tournament_group_id=fixture.group_id,
            tournament_round=fixture.round_label,
        )
        match = await match_service.create_match(session, user, payload)
        created.append(match)

    if tournament.status is TournamentStatus.DRAFT and created:
        tournament.status = TournamentStatus.ACTIVE
    await session.flush()
    return created


async def generate_round_robin(
    session: AsyncSession, user: User, tournament: Tournament, payload: RoundRobinGenerate
) -> list[Match]:
    """Every team plays every other team, within its group when groups exist."""
    by_group: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for participant in tournament.participants:
        by_group.setdefault(participant.group_id, []).append(participant.team_id)

    if not any(len(teams) >= 2 for teams in by_group.values()):
        raise RuleViolation(
            "Enter at least two teams (in the same group) before generating fixtures.",
            code="not_enough_teams",
        )

    fixtures: list[FixtureInput] = []
    for group_id, teams in by_group.items():
        pairs = list(itertools.combinations(sorted(teams, key=str), 2))
        if payload.double_round:
            pairs += [(b, a) for a, b in pairs]
        for team_a, team_b in pairs:
            fixtures.append(
                FixtureInput(
                    team_a_id=team_a,
                    team_b_id=team_b,
                    group_id=group_id,
                    venue=payload.venue or tournament.venue,
                    overs_limit=payload.overs_limit or tournament.default_overs_limit,
                    round_label="Group stage" if group_id else "League",
                )
            )

    if payload.start_date is not None:
        for index, fixture in enumerate(fixtures):
            fixture.scheduled_at = payload.start_date + timedelta(
                minutes=payload.interval_minutes * index
            )

    return await create_fixtures(session, user, tournament, fixtures)


def _default_format(tournament: Tournament) -> Any:
    from app.models.enums import MatchFormat

    overs = tournament.default_overs_limit
    if overs == 20:
        return MatchFormat.T20
    if overs == 10:
        return MatchFormat.T10
    if overs == 50:
        return MatchFormat.ODI
    return MatchFormat.CUSTOM


# ------------------------------------------------------------------- standings


async def compute_and_store_standings(
    session: AsyncSession, tournament: Tournament
) -> StandingsResult:
    records = await _match_records(session, tournament)

    team_names: dict[str, str] = {}
    team_groups: dict[str, tuple[str | None, str | None]] = {}
    adjustments: dict[str, int] = {}
    group_names = {str(g.id): g.name for g in tournament.groups}

    for participant in tournament.participants:
        team = (
            await session.execute(select(Team).where(Team.id == participant.team_id).limit(1))
        ).scalar_one_or_none()
        key = str(participant.team_id)
        team_names[key] = team.name if team else "Unknown team"
        group_id = str(participant.group_id) if participant.group_id else None
        team_groups[key] = (group_id, group_names.get(group_id or ""))
        if participant.points_adjustment:
            adjustments[key] = participant.points_adjustment

    rows = compute_standings(
        records,
        config=PointsConfig(
            win=tournament.points_per_win,
            tie=tournament.points_per_tie,
            loss=tournament.points_per_loss,
            no_result=tournament.points_per_no_result,
            use_net_run_rate=tournament.use_net_run_rate,
        ),
        team_names=team_names,
        team_groups=team_groups,
        points_adjustments=adjustments,
    )

    await session.execute(
        sql_delete(TournamentStandingSnapshot).where(
            TournamentStandingSnapshot.tournament_id == tournament.id
        )
    )
    for row in rows:
        session.add(
            TournamentStandingSnapshot(
                tournament_id=tournament.id,
                team_id=uuid.UUID(row.team_id),
                group_id=uuid.UUID(row.group_id) if row.group_id else None,
                played=row.played,
                won=row.won,
                lost=row.lost,
                tied=row.tied,
                no_result=row.no_result,
                points=row.points,
                runs_scored=row.runs_scored,
                overs_faced=row.overs_faced,
                runs_conceded=row.runs_conceded,
                overs_bowled=row.overs_bowled,
                net_run_rate=row.net_run_rate,
                position=row.position,
            )
        )
    await session.flush()

    result = StandingsResult(rows=rows, groups=list(tournament.groups))
    await state_cache.put_standings(tournament.public_slug, result.to_dict(tournament))
    return result


async def _match_records(session: AsyncSession, tournament: Tournament) -> list[TeamMatchRecord]:
    result = await session.execute(
        select(Match)
        .options(selectinload(Match.innings).selectinload(Innings.summary))
        .where(
            Match.tournament_id == tournament.id,
            Match.deleted_at.is_(None),
            Match.status.in_([MatchStatus.COMPLETED, MatchStatus.ABANDONED]),
        )
    )
    matches = list(result.scalars().unique())

    records: list[TeamMatchRecord] = []
    for match in matches:
        team_a, team_b = str(match.team_a_id), str(match.team_b_id)
        totals: dict[str, tuple[int, float]] = {}
        for innings in match.innings:
            if innings.summary is None or innings.is_super_over:
                continue
            key = str(innings.batting_team_id)
            runs, overs = totals.get(key, (0, 0.0))
            totals[key] = (
                runs + innings.summary.total_runs,
                overs + float(innings.summary.nrr_overs),
            )

        no_result = match.status is MatchStatus.ABANDONED or match.result_type in (
            MatchResultType.NO_RESULT,
            MatchResultType.ABANDONED,
        )
        has_rate_data = len(totals) == 2 and not no_result

        for team_id, opponent_id in ((team_a, team_b), (team_b, team_a)):
            if no_result:
                outcome = "no_result"
            elif match.result_type is MatchResultType.TIE:
                outcome = "tie"
            elif match.winner_team_id is not None:
                outcome = "win" if str(match.winner_team_id) == team_id else "loss"
            else:
                outcome = "no_result"

            scored, faced = totals.get(team_id, (0, 0.0))
            conceded, bowled = totals.get(opponent_id, (0, 0.0))
            records.append(
                TeamMatchRecord(
                    team_id=team_id,
                    match_id=str(match.id),
                    outcome=outcome,
                    runs_scored=scored,
                    overs_faced=faced,
                    runs_conceded=conceded,
                    overs_bowled=bowled,
                    counts_for_run_rate=has_rate_data,
                )
            )
    return records


async def on_match_result(session: AsyncSession, match: Match) -> None:
    """Called when a match result lands: refresh standings and the bracket."""
    if match.tournament_id is None:
        return
    tournament = await load_tournament(session, tournament_id=match.tournament_id)
    # This both stores the snapshot rows and refreshes the cached payload, so the
    # public points table is correct the instant the last ball is recorded.
    await compute_and_store_standings(session, tournament)
    await advance_bracket(session, tournament, match)


# --------------------------------------------------------------------- bracket


async def generate_bracket(
    session: AsyncSession, tournament: Tournament, payload: BracketGenerate
) -> list[BracketMatch]:
    """Build a single-elimination bracket, seeded from the current standings."""
    per_group = payload.teams_advancing_per_group or tournament.teams_advancing_per_group
    if tournament.tournament_format is TournamentFormat.LEAGUE:
        raise RuleViolation(
            "This is a league tournament. Switch the format to group + knockout to use a bracket.",
            code="bracket_not_applicable",
        )

    seeds: list[tuple[str, uuid.UUID | None]] = []
    if payload.seed_from_standings:
        standings = await compute_and_store_standings(session, tournament)
        groups = sorted(tournament.groups, key=lambda g: g.ordinal)
        if groups:
            for position in range(1, per_group + 1):
                for group in groups:
                    row = next(
                        (
                            r
                            for r in standings.rows
                            if r.group_id == str(group.id) and r.position == position
                        ),
                        None,
                    )
                    seeds.append(
                        (f"{group.name} #{position}", uuid.UUID(row.team_id) if row else None)
                    )
        else:
            advancing = per_group * 2
            for row in standings.rows[:advancing]:
                seeds.append((f"League #{row.position}", uuid.UUID(row.team_id)))
    else:
        for participant in sorted(
            tournament.participants, key=lambda p: (p.seed or 99, str(p.team_id))
        ):
            seeds.append((f"Seed {participant.seed or '-'}", participant.team_id))

    if len(seeds) < 2:
        raise RuleViolation(
            "At least two teams must qualify before a bracket can be built.",
            code="not_enough_qualifiers",
        )

    size = 1 << max(1, (len(seeds) - 1).bit_length())
    seeds += [("Bye", None)] * (size - len(seeds))

    await session.execute(
        sql_delete(BracketMatch).where(BracketMatch.tournament_id == tournament.id)
    )
    tournament.bracket.clear()
    await session.flush()

    ordinal = 0
    rounds: list[list[BracketMatch]] = []
    pairings = _seed_pairings(size)
    current: list[BracketMatch] = []
    for slot_a, slot_b in pairings:
        label_a, team_a = seeds[slot_a]
        label_b, team_b = seeds[slot_b]
        ordinal += 1
        node = BracketMatch(
            tournament_id=tournament.id,
            round=_ROUND_BY_SIZE.get(size // 2, BracketRound.QUARTER_FINAL),
            ordinal=ordinal,
            label=f"{label_a} vs {label_b}",
            team_a_id=team_a,
            team_b_id=team_b,
            source_a_label=label_a,
            source_b_label=label_b,
        )
        session.add(node)
        current.append(node)
    rounds.append(current)
    await session.flush()

    while len(current) > 1:
        next_round: list[BracketMatch] = []
        round_size = len(current) // 2
        for index in range(round_size):
            ordinal += 1
            node = BracketMatch(
                tournament_id=tournament.id,
                round=_ROUND_BY_SIZE.get(round_size, BracketRound.QUARTER_FINAL),
                ordinal=ordinal,
                source_a_bracket_id=current[index * 2].id,
                source_b_bracket_id=current[index * 2 + 1].id,
                source_a_label=f"Winner of match {current[index * 2].ordinal}",
                source_b_label=f"Winner of match {current[index * 2 + 1].ordinal}",
            )
            session.add(node)
            next_round.append(node)
        await session.flush()
        for index, node in enumerate(next_round):
            current[index * 2].next_bracket_match_id = node.id
            current[index * 2].next_slot = "a"
            current[index * 2 + 1].next_bracket_match_id = node.id
            current[index * 2 + 1].next_slot = "b"
        rounds.append(next_round)
        current = next_round

    if payload.include_third_place and len(rounds) >= 2:
        ordinal += 1
        session.add(
            BracketMatch(
                tournament_id=tournament.id,
                round=BracketRound.THIRD_PLACE,
                ordinal=ordinal,
                label="Third place play-off",
                source_a_label="Loser of semi-final 1",
                source_b_label="Loser of semi-final 2",
            )
        )

    await session.flush()
    flat = [node for round_nodes in rounds for node in round_nodes]
    tournament.bracket.extend(flat)
    logger.info(
        "bracket_generated", tournament_id=str(tournament.id), rounds=len(rounds), slots=len(flat)
    )
    return flat


def _seed_pairings(size: int) -> list[tuple[int, int]]:
    """Standard bracket pairing: 1 v N, 2 v N-1, and so on."""
    return [(index, size - 1 - index) for index in range(size // 2)]


async def advance_bracket(session: AsyncSession, tournament: Tournament, match: Match) -> None:
    node = next((b for b in tournament.bracket if b.match_id == match.id), None)
    if node is None:
        return
    node.winner_team_id = match.winner_team_id
    if match.winner_team_id is None or node.next_bracket_match_id is None:
        return
    nxt = next((b for b in tournament.bracket if b.id == node.next_bracket_match_id), None)
    if nxt is None:
        return
    if node.next_slot == "a":
        nxt.team_a_id = match.winner_team_id
    else:
        nxt.team_b_id = match.winner_team_id
    logger.info(
        "bracket_advanced",
        tournament_id=str(tournament.id),
        from_ordinal=node.ordinal,
        to_ordinal=nxt.ordinal,
    )


async def link_bracket_match(
    session: AsyncSession, tournament: Tournament, bracket_id: uuid.UUID, match_id: uuid.UUID
) -> BracketMatch:
    node = next((b for b in tournament.bracket if b.id == bracket_id), None)
    if node is None:
        raise NotFound("That bracket slot does not exist.", code="bracket_slot_not_found")
    match = (
        (
            await session.execute(
                select(Match)
                .options(joinedload(Match.team_a), joinedload(Match.team_b))
                .where(Match.id == match_id, Match.tournament_id == tournament.id)
                .limit(1)
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if match is None:
        raise NotFound("That match is not part of this tournament.", code="match_not_found")
    node.match_id = match.id
    node.team_a_id = match.team_a_id
    node.team_b_id = match.team_b_id
    return node
