"""Match setup and lifecycle.

Creating a match is the one genuinely fiddly write in the product: it may create
teams, extend rosters, build two squads, and record the toss, all in one
transaction, from a form filled in on a phone at the ground.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.core.errors import Conflict, Forbidden, NotFound, RuleViolation, VersionConflict
from app.core.logging import get_logger
from app.models.enums import (
    AuditAction,
    CollaboratorRole,
    InningsEndReason,
    InningsStatus,
    MatchFormat,
    MatchStatus,
    TossDecision,
)
from app.models.match import Innings, Match, MatchCollaborator, MatchPlayer
from app.models.team import Player, Team
from app.models.tournament import Tournament
from app.models.user import User
from app.realtime.broker import broker, channel_for_match
from app.realtime.events import EventType, envelope
from app.schemas.match import (
    InningsCreate,
    MatchCreate,
    MatchTeamInput,
    MatchUpdate,
    SquadPlayerInput,
)
from app.services import audit_service, state_cache
from app.utils.slugs import build_public_slug

logger = get_logger(__name__)

MIN_SQUAD_TO_SCORE = 2


# --------------------------------------------------------------------- creation


async def create_match(
    session: AsyncSession,
    user: User,
    payload: MatchCreate,
    *,
    request: Request | None = None,
) -> Match:
    tournament = await _resolve_tournament(session, user, payload.tournament_id)

    team_a = await _resolve_team(session, user, payload.team_a)
    team_b = await _resolve_team(session, user, payload.team_b)
    if team_a.id == team_b.id:
        raise RuleViolation("A match needs two different teams.", code="teams_identical")

    rules = payload.rules
    if tournament is not None:
        # Tournament defaults fill in anything the fixture did not state.
        if rules.overs_limit is None:
            rules.overs_limit = tournament.default_overs_limit
        if rules.max_overs_per_bowler is None:
            rules.max_overs_per_bowler = tournament.default_max_overs_per_bowler

    match = Match(
        public_slug=build_public_slug(team_a.name, "vs", team_b.name),
        created_by_user_id=user.id,
        tournament_id=tournament.id if tournament else None,
        tournament_group_id=payload.tournament_group_id,
        tournament_round=payload.tournament_round,
        team_a_id=team_a.id,
        team_b_id=team_b.id,
        title=payload.title or f"{team_a.name} vs {team_b.name}",
        venue=payload.venue,
        city=payload.city,
        match_format=payload.match_format,
        status=MatchStatus.SETUP,
        overs_limit=rules.overs_limit,
        balls_per_over=rules.balls_per_over,
        players_per_side=rules.players_per_side,
        max_overs_per_bowler=rules.max_overs_per_bowler,
        wide_penalty_runs=rules.wide_penalty_runs,
        no_ball_penalty_runs=rules.no_ball_penalty_runs,
        free_hit_after_no_ball=rules.free_hit_after_no_ball,
        allow_boundaries=rules.allow_boundaries,
        last_batter_can_bat_alone=rules.last_batter_can_bat_alone,
        dls_enabled=rules.dls_enabled,
        rule_overrides=rules.overrides,
        scheduled_at=payload.scheduled_at,
    )
    if payload.match_format is MatchFormat.TEST:
        match.overs_limit = None

    session.add(match)
    # Nothing can lazy-load on an async session, and a brand new match has no
    # children by definition, so mark the collections as loaded-and-empty.
    for collection in ("squad", "innings", "collaborators"):
        set_committed_value(match, collection, [])
    await session.flush()

    await _replace_squad(
        session, match, team_a, await _squad_or_roster(session, team_a, payload.team_a, match)
    )
    await _replace_squad(
        session, match, team_b, await _squad_or_roster(session, team_b, payload.team_b, match)
    )

    if payload.toss is not None:
        _apply_toss(match, payload.toss.winner_team_id, payload.toss.decision)

    await audit_service.record(
        session,
        AuditAction.MATCH_CREATED,
        actor_user_id=user.id,
        entity_type="match",
        entity_id=match.id,
        context={"slug": match.public_slug, "format": match.match_format.value},
        request=request,
    )
    return match


async def _resolve_tournament(
    session: AsyncSession, user: User, tournament_id: uuid.UUID | None
) -> Tournament | None:
    if tournament_id is None:
        return None
    tournament = (
        await session.execute(
            select(Tournament)
            .where(Tournament.id == tournament_id, Tournament.deleted_at.is_(None))
            .limit(1)
        )
    ).scalar_one_or_none()
    if tournament is None:
        raise NotFound("That tournament does not exist.", code="tournament_not_found")
    if tournament.created_by_user_id != user.id and not user.is_admin:
        raise Forbidden("You cannot add fixtures to someone else's tournament.")
    return tournament


async def _resolve_team(session: AsyncSession, user: User, payload: MatchTeamInput) -> Team:
    """Find the saved team, or create it, reusing an existing name-match."""
    if payload.team_id is not None:
        team = (
            await session.execute(
                select(Team).where(Team.id == payload.team_id, Team.deleted_at.is_(None)).limit(1)
            )
        ).scalar_one_or_none()
        if team is None:
            raise NotFound("That team does not exist.", code="team_not_found")
        if team.owner_user_id != user.id and not user.is_admin:
            raise Forbidden("You can only use teams from your own account.")
        return team

    assert payload.name is not None  # guaranteed by the schema validator
    existing = (
        await session.execute(
            select(Team)
            .where(
                Team.owner_user_id == user.id,
                func.lower(Team.name) == payload.name.lower(),
                Team.deleted_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    team = Team(
        owner_user_id=user.id,
        name=payload.name,
        short_name=payload.short_name,
    )
    session.add(team)
    await session.flush()
    return team


async def _squad_or_roster(
    session: AsyncSession, team: Team, payload: MatchTeamInput, match: Match
) -> list[SquadPlayerInput]:
    """Fall back to the team's saved roster when no squad was named.

    Picking a saved team and saying nothing about players means "the usual XI", not
    "nobody". Without this, such a match is created in a state that cannot be
    scored, and the caller only finds out when the first innings is refused.
    """
    if payload.players:
        return payload.players
    roster = (
        await session.execute(
            select(Player.id)
            .where(
                Player.team_id == team.id,
                Player.deleted_at.is_(None),
                Player.is_active.is_(True),
            )
            .order_by(Player.sort_order, Player.name)
            .limit(match.players_per_side)
        )
    ).scalars()
    return [SquadPlayerInput(player_id=player_id) for player_id in roster]


async def _replace_squad(
    session: AsyncSession, match: Match, team: Team, players: list[SquadPlayerInput]
) -> None:
    """Build the match squad, extending the saved roster with any new names."""
    roster = {
        p.name.lower(): p
        for p in (
            await session.execute(
                select(Player).where(Player.team_id == team.id, Player.deleted_at.is_(None))
            )
        ).scalars()
    }
    roster_by_id = {p.id: p for p in roster.values()}

    seen_names: set[str] = set()
    for order, entry in enumerate(players, start=1):
        player: Player | None = None
        if entry.player_id is not None:
            player = roster_by_id.get(entry.player_id)
            if player is None:
                raise RuleViolation(
                    "That player is not on the team's roster.",
                    code="player_not_on_team",
                    details={"player_id": str(entry.player_id), "team_id": str(team.id)},
                )
            name = player.name
        else:
            assert entry.name is not None
            name = entry.name
            player = roster.get(name.lower())
            if player is None:
                # Persist walk-up players so the roster is reusable next week.
                player = Player(team_id=team.id, name=name, sort_order=order)
                session.add(player)
                await session.flush()
                roster[name.lower()] = player
                roster_by_id[player.id] = player

        if name.lower() in seen_names:
            raise RuleViolation(
                f"{name} is listed twice in the same squad.",
                code="duplicate_squad_member",
                details={"name": name},
            )
        seen_names.add(name.lower())

        member = MatchPlayer(
            match_id=match.id,
            team_id=team.id,
            player_id=player.id,
            name=name,
            batting_order=entry.batting_order or order,
            is_captain=entry.is_captain,
            is_wicket_keeper=entry.is_wicket_keeper,
            is_playing=entry.is_playing,
        )
        session.add(member)
        match.squad.append(member)

    if len({p.batting_order for p in match.squad if p.team_id == team.id}) != len(
        [p for p in match.squad if p.team_id == team.id]
    ):  # pragma: no cover - guarded by the unique constraint
        raise RuleViolation("Batting order numbers must be unique.", code="duplicate_batting_order")

    await session.flush()


# ---------------------------------------------------------------------- updates


def _apply_toss(match: Match, winner_team_id: uuid.UUID, decision: TossDecision) -> None:
    if winner_team_id not in (match.team_a_id, match.team_b_id):
        raise RuleViolation(
            "The toss winner must be one of the two teams playing.", code="invalid_toss_winner"
        )
    if match.innings:
        raise Conflict(
            "The toss cannot be changed once the first innings has started.",
            code="toss_locked",
        )
    match.toss_winner_team_id = winner_team_id
    match.toss_decision = decision


async def update_match(
    session: AsyncSession,
    match: Match,
    payload: MatchUpdate,
    *,
    actor: User,
    request: Request | None = None,
) -> Match:
    _check_version(match, payload.expected_state_version)

    if payload.title is not None:
        match.title = payload.title
    if payload.venue is not None:
        match.venue = payload.venue
    if payload.city is not None:
        match.city = payload.city
    if payload.scheduled_at is not None:
        match.scheduled_at = payload.scheduled_at

    if payload.rules is not None:
        if match.status is not MatchStatus.SETUP:
            # Changing the over count mid-match is a rain reduction, which is an
            # innings-level decision, not a match-level one.
            raise Conflict(
                "Match rules can only be changed before the first ball. Use the innings "
                "endpoint to revise the overs for a rain-affected innings.",
                code="rules_locked",
            )
        rules = payload.rules
        match.overs_limit = rules.overs_limit
        match.balls_per_over = rules.balls_per_over
        match.players_per_side = rules.players_per_side
        match.max_overs_per_bowler = rules.max_overs_per_bowler
        match.wide_penalty_runs = rules.wide_penalty_runs
        match.no_ball_penalty_runs = rules.no_ball_penalty_runs
        match.free_hit_after_no_ball = rules.free_hit_after_no_ball
        match.allow_boundaries = rules.allow_boundaries
        match.last_batter_can_bat_alone = rules.last_batter_can_bat_alone
        match.dls_enabled = rules.dls_enabled
        match.rule_overrides = rules.overrides

    if payload.toss is not None:
        _apply_toss(match, payload.toss.winner_team_id, payload.toss.decision)

    match.state_version += 1
    await audit_service.record(
        session,
        AuditAction.MATCH_UPDATED,
        actor_user_id=actor.id,
        entity_type="match",
        entity_id=match.id,
        request=request,
    )
    return match


async def replace_squad(
    session: AsyncSession, match: Match, team_id: uuid.UUID, players: list[SquadPlayerInput]
) -> None:
    """Rewrite one side's squad. Refused once that side has faced a ball."""
    if team_id not in (match.team_a_id, match.team_b_id):
        raise NotFound("That team is not in this match.", code="team_not_in_match")

    existing = [m for m in match.squad if m.team_id == team_id]
    used_ids = (
        {d.striker_id for innings in match.innings for d in innings.deliveries}
        | {d.bowler_id for innings in match.innings for d in innings.deliveries}
        | {d.non_striker_id for innings in match.innings for d in innings.deliveries}
    )
    if any(member.id in used_ids for member in existing):
        raise Conflict(
            "This squad already appears in the delivery log. Edit individual players "
            "instead of replacing the whole squad.",
            code="squad_in_use",
        )

    for member in existing:
        await session.delete(member)
    await session.flush()
    match.squad = [m for m in match.squad if m.team_id != team_id]

    team = match.team_a if match.team_a_id == team_id else match.team_b
    await _replace_squad(session, match, team, players)
    match.state_version += 1


async def soft_delete_match(
    session: AsyncSession, match: Match, *, actor: User, request: Request | None = None
) -> None:
    match.deleted_at = datetime.now(UTC)
    match.state_version += 1
    # The share link reads through Redis, so a warm projection would keep serving a
    # deleted match until its TTL expired. Drop it, and tell any viewer still
    # watching to refetch — which is how they learn the match is gone.
    await state_cache.invalidate_match(match.public_slug)
    await broker.publish(
        channel_for_match(str(match.id)),
        envelope(
            EventType.MATCH_UPDATED,
            match_id=str(match.id),
            state_version=match.state_version,
            data={"deleted": True},
        ),
    )
    await audit_service.record(
        session,
        AuditAction.MATCH_DELETED,
        actor_user_id=actor.id,
        entity_type="match",
        entity_id=match.id,
        request=request,
    )


# -------------------------------------------------------------------- lifecycle


async def start_innings(
    session: AsyncSession,
    match: Match,
    payload: InningsCreate,
    *,
    actor: User,
    request: Request | None = None,
) -> Innings:
    if match.status is MatchStatus.COMPLETED:
        raise Conflict("This match is already complete.", code="match_completed")
    if match.status is MatchStatus.ABANDONED:
        raise Conflict("This match was abandoned.", code="match_abandoned")

    open_innings = next((i for i in match.innings if i.status is InningsStatus.IN_PROGRESS), None)
    if open_innings is not None:
        raise Conflict(
            "An innings is already in progress. Close it before starting the next one.",
            code="innings_in_progress",
            details={"innings_id": str(open_innings.id)},
        )

    squad_sizes = {
        team_id: len([m for m in match.squad if str(m.team_id) == team_id and m.is_playing])
        for team_id in (str(match.team_a_id), str(match.team_b_id))
    }
    for team_id, size in squad_sizes.items():
        if size < MIN_SQUAD_TO_SCORE:
            raise RuleViolation(
                "Both sides need at least two players before scoring can start.",
                code="squad_too_small",
                details={"team_id": team_id, "players": size},
            )

    sequence = max((i.sequence for i in match.innings), default=0) + 1
    batting_team_id = payload.batting_team_id or _default_batting_team(match, sequence)
    if batting_team_id not in (match.team_a_id, match.team_b_id):
        raise RuleViolation("The batting side must be one of the two teams.", code="invalid_team")
    bowling_team_id = match.team_b_id if batting_team_id == match.team_a_id else match.team_a_id

    innings = Innings(
        match_id=match.id,
        sequence=sequence,
        batting_team_id=batting_team_id,
        bowling_team_id=bowling_team_id,
        status=InningsStatus.IN_PROGRESS,
        overs_limit=payload.overs_limit,
        target_runs=payload.target_runs,
        is_super_over=payload.is_super_over,
        is_follow_on=payload.is_follow_on,
        started_at=datetime.now(UTC),
    )
    session.add(innings)
    set_committed_value(innings, "deliveries", [])
    set_committed_value(innings, "summary", None)
    match.innings.append(innings)

    match.status = MatchStatus.LIVE
    if match.started_at is None:
        match.started_at = datetime.now(UTC)
    match.state_version += 1
    await session.flush()

    await audit_service.record(
        session,
        AuditAction.INNINGS_STARTED,
        actor_user_id=actor.id,
        entity_type="innings",
        entity_id=innings.id,
        context={"match_id": str(match.id), "sequence": sequence},
        request=request,
    )
    return innings


def _default_batting_team(match: Match, sequence: int) -> uuid.UUID:
    """Who bats, derived from the toss for innings 1 and alternating after."""
    if match.toss_winner_team_id is None or match.toss_decision is None:
        if sequence == 1:
            raise RuleViolation(
                "Record the toss before starting the first innings.", code="toss_required"
            )
        return match.team_a_id

    winner = match.toss_winner_team_id
    other = match.team_b_id if winner == match.team_a_id else match.team_a_id
    first_batting = winner if match.toss_decision is TossDecision.BAT else other
    second_batting = other if first_batting == winner else winner
    return first_batting if sequence % 2 == 1 else second_batting


async def close_innings(
    session: AsyncSession,
    innings: Innings,
    *,
    end_reason: InningsEndReason,
    actor: User | None = None,
    request: Request | None = None,
) -> None:
    if innings.status is InningsStatus.COMPLETED:
        return
    innings.status = InningsStatus.COMPLETED
    innings.end_reason = end_reason
    innings.completed_at = datetime.now(UTC)
    await audit_service.record(
        session,
        AuditAction.INNINGS_CLOSED,
        actor_user_id=actor.id if actor else None,
        entity_type="innings",
        entity_id=innings.id,
        context={"end_reason": end_reason.value},
        request=request,
    )


def _check_version(match: Match, expected: int | None) -> None:
    if expected is not None and expected != match.state_version:
        raise VersionConflict(
            details={"expected": expected, "actual": match.state_version},
        )


async def add_collaborator(
    session: AsyncSession,
    match: Match,
    *,
    email: str,
    role: CollaboratorRole,
    invited_by: User,
) -> MatchCollaborator:
    user = (
        await session.execute(
            select(User).where(func.lower(User.email) == email.strip().lower()).limit(1)
        )
    ).scalar_one_or_none()
    if user is None:
        raise NotFound(
            "No account uses that email address. Ask them to sign up first.",
            code="user_not_found",
        )
    if user.id == match.created_by_user_id:
        raise Conflict("That person already owns this match.", code="already_owner")

    existing = next((c for c in match.collaborators if c.user_id == user.id), None)
    if existing is not None:
        existing.role = role
        return existing

    collaborator = MatchCollaborator(
        match_id=match.id, user_id=user.id, role=role, invited_by_user_id=invited_by.id
    )
    session.add(collaborator)
    match.collaborators.append(collaborator)
    return collaborator


def list_item_payload(match: Match, score_line: str | None = None) -> dict[str, Any]:
    return {
        "id": match.id,
        "public_slug": match.public_slug,
        "title": match.title,
        "status": match.status,
        "match_format": match.match_format,
        "venue": match.venue,
        "scheduled_at": match.scheduled_at,
        "started_at": match.started_at,
        "completed_at": match.completed_at,
        "result_summary": match.result_summary,
        "state_version": match.state_version,
        "team_a_id": match.team_a_id,
        "team_b_id": match.team_b_id,
        "team_a_name": match.team_a.name if match.team_a else None,
        "team_b_name": match.team_b.name if match.team_b else None,
        "tournament_id": match.tournament_id,
        "score_line": score_line,
    }
