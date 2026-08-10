"""Loading a match and turning it into a scorecard.

This is the one place that knows how to go from rows in Postgres to the derived
picture of a match: it loads the delivery log, replays it through the scoring
engine for every innings, works out the chase target, and assembles the payload
used by the scoring console, the public scorecard, the broadcast overlay, and the
realtime feed.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.config import settings
from app.core.errors import NotFound
from app.models.enums import InningsStatus, MatchFormat, MatchStatus
from app.models.match import Delivery, Innings, Match, MatchPlayer
from app.models.team import Team
from app.scoring import (
    DeliveryEvent,
    InningsRules,
    InningsState,
    InningsView,
    MatchOutcome,
    PlayerRef,
    build_innings_state,
    compute_target,
    determine_outcome,
)


@dataclass(slots=True)
class InningsSnapshot:
    innings: Innings
    state: InningsState
    batting_team: Team
    bowling_team: Team
    #: Kept alongside the state so the write path can validate a new ball without
    #: re-deriving the rule set (and risking a mismatch with the replay).
    rules: InningsRules
    batting_refs: list[PlayerRef]
    bowling_refs: list[PlayerRef]
    events: list[DeliveryEvent]

    def to_dict(self, *, include_timeline: bool = True) -> dict[str, Any]:
        return {
            "id": str(self.innings.id),
            "sequence": self.innings.sequence,
            "status": self.innings.status.value,
            "batting_team_id": str(self.innings.batting_team_id),
            "bowling_team_id": str(self.innings.bowling_team_id),
            "batting_team_name": self.batting_team.name,
            "bowling_team_name": self.bowling_team.name,
            "is_super_over": self.innings.is_super_over,
            "is_follow_on": self.innings.is_follow_on,
            "overs_limit": self.state.overs_limit,
            "target_runs": self.state.target_runs,
            # The browser engine needs this to reproduce the total exactly.
            "penalty_runs": self.innings.penalty_runs,
            "end_reason": (
                self.innings.end_reason.value
                if self.innings.end_reason
                else (self.state.end_reason.value if self.state.end_reason else None)
            ),
            "state": self.state.to_dict(include_timeline=include_timeline),
        }


@dataclass(slots=True)
class MatchSnapshot:
    match: Match
    innings: list[InningsSnapshot]
    squads: dict[str, list[MatchPlayer]]
    outcome: MatchOutcome

    # ------------------------------------------------------------- accessors
    @property
    def current(self) -> InningsSnapshot | None:
        """The innings a scorer would be working on right now."""
        for snapshot in self.innings:
            if snapshot.innings.status is InningsStatus.IN_PROGRESS:
                return snapshot
        for snapshot in reversed(self.innings):
            if not snapshot.state.is_complete:
                return snapshot
        return self.innings[-1] if self.innings else None

    def innings_by_id(self, innings_id: uuid.UUID) -> InningsSnapshot | None:
        return next((s for s in self.innings if s.innings.id == innings_id), None)

    def player_name(self, player_id: str | None) -> str | None:
        if not player_id:
            return None
        for members in self.squads.values():
            for member in members:
                if str(member.id) == player_id:
                    return member.name
        return None

    # -------------------------------------------------------------- payloads
    def match_dict(self) -> dict[str, Any]:
        match = self.match
        return {
            "id": str(match.id),
            "slug": match.public_slug,
            "title": match.title or f"{match.team_a.name} vs {match.team_b.name}",
            "status": match.status.value,
            "format": match.match_format.value,
            "venue": match.venue,
            "city": match.city,
            "scheduled_at": match.scheduled_at,
            "started_at": match.started_at,
            "completed_at": match.completed_at,
            "state_version": match.state_version,
            "share_url": settings.public_match_url(match.public_slug),
            "tournament": (
                {
                    "id": str(match.tournament.id),
                    "name": match.tournament.name,
                    "slug": match.tournament.public_slug,
                    "round": match.tournament_round,
                }
                if match.tournament
                else None
            ),
            "teams": {
                "a": _team_dict(match.team_a),
                "b": _team_dict(match.team_b),
            },
            "toss": {
                "winner_team_id": str(match.toss_winner_team_id)
                if match.toss_winner_team_id
                else None,
                "decision": match.toss_decision.value if match.toss_decision else None,
            },
            "rules": {
                "overs_limit": match.overs_limit,
                "balls_per_over": match.balls_per_over,
                "players_per_side": match.players_per_side,
                "max_overs_per_bowler": match.max_overs_per_bowler,
                "wide_penalty_runs": match.wide_penalty_runs,
                "no_ball_penalty_runs": match.no_ball_penalty_runs,
                "free_hit_after_no_ball": match.free_hit_after_no_ball,
                "allow_boundaries": match.allow_boundaries,
                "last_batter_can_bat_alone": match.last_batter_can_bat_alone,
                "dls_enabled": match.dls_enabled,
                "overrides": match.rule_overrides,
            },
        }

    def to_dict(
        self, *, include_timeline: bool = True, include_squads: bool = True
    ) -> dict[str, Any]:
        current = self.current
        payload: dict[str, Any] = {
            "match": self.match_dict(),
            "result": {
                "type": self.match.result_type.value if self.match.result_type else None,
                "winner_team_id": str(self.match.winner_team_id)
                if self.match.winner_team_id
                else None,
                "summary": self.match.result_summary or self.outcome.summary,
                "margin_runs": self.match.win_margin_runs,
                "margin_wickets": self.match.win_margin_wickets,
                "is_decided": self.outcome.is_decided,
            },
            "innings": [s.to_dict(include_timeline=include_timeline) for s in self.innings],
            "current_innings_id": str(current.innings.id) if current else None,
        }
        if include_squads:
            payload["squads"] = {
                team_id: [_squad_member_dict(m) for m in members]
                for team_id, members in self.squads.items()
            }
        return payload

    def compact(self) -> dict[str, Any]:
        """Small payload for realtime frames and the broadcast overlay."""
        match = self.match
        toss_winner = None
        if match.toss_winner_team_id:
            if match.toss_winner_team_id == match.team_a_id:
                toss_winner = _team_dict(match.team_a)
            elif match.toss_winner_team_id == match.team_b_id:
                toss_winner = _team_dict(match.team_b)

        meta = {
            "title": match.title,
            "venue": match.venue,
            "city": match.city,
            "tournament": (
                {
                    "id": str(match.tournament.id),
                    "name": match.tournament.name,
                    "slug": match.tournament.public_slug,
                    "round": match.tournament_round,
                }
                if match.tournament
                else None
            ),
            "toss": {
                "winner": toss_winner,
                "winner_team_id": str(match.toss_winner_team_id)
                if match.toss_winner_team_id
                else None,
                "decision": match.toss_decision.value if match.toss_decision else None,
            },
        }

        current = self.current
        if current is None:
            return {
                "status": match.status.value,
                "state_version": match.state_version,
                "title": match.title,
                "result_summary": match.result_summary or self.outcome.summary,
                **meta,
            }
        state = current.state
        photo_map = _photo_map(self.squads)
        return {
            "status": match.status.value,
            "state_version": match.state_version,
            "innings_id": str(current.innings.id),
            "innings_sequence": current.innings.sequence,
            "batting_team": _team_dict(current.batting_team),
            "bowling_team": _team_dict(current.bowling_team),
            "score": {
                "runs": state.total_runs,
                "wickets": state.wickets,
                "overs_text": state.overs_text,
                "run_rate": state.run_rate,
                "required_run_rate": state.required_run_rate,
                "target_runs": state.target_runs,
                "runs_needed": state.runs_needed,
                "balls_remaining": state.balls_remaining,
                "extras_total": state.extras.total,
                "is_free_hit": state.is_free_hit,
            },
            "striker": _batter_line(state, state.striker_id, photo_map),
            "non_striker": _batter_line(state, state.non_striker_id, photo_map),
            "bowler": _bowler_line(state, state.current_bowler_id, photo_map),
            "current_partnership": (
                state.current_partnership.to_dict() if state.current_partnership else None
            ),
            "recent_balls": [b.to_dict() for b in state.timeline[-8:]],
            "result_summary": match.result_summary or self.outcome.summary,
            "next_action": state.next_action.value,
            **meta,
        }


# --------------------------------------------------------------------- loading


async def load_match(
    session: AsyncSession,
    *,
    match_id: uuid.UUID | None = None,
    slug: str | None = None,
    include_deleted: bool = False,
) -> Match:
    if match_id is None and slug is None:  # pragma: no cover - programming error
        raise ValueError("Provide match_id or slug")

    stmt = (
        select(Match)
        .options(
            joinedload(Match.team_a),
            joinedload(Match.team_b),
            joinedload(Match.tournament),
            selectinload(Match.squad).selectinload(MatchPlayer.player),
            selectinload(Match.collaborators),
            selectinload(Match.innings).selectinload(Innings.deliveries),
            selectinload(Match.innings).selectinload(Innings.summary),
        )
        .limit(1)
    )
    stmt = stmt.where(Match.id == match_id) if match_id else stmt.where(Match.public_slug == slug)
    if not include_deleted:
        stmt = stmt.where(Match.deleted_at.is_(None))

    match = (await session.execute(stmt)).unique().scalar_one_or_none()
    if match is None:
        raise NotFound(
            "That match does not exist, or the link is no longer valid.", code="match_not_found"
        )
    return match


async def build_snapshot(session: AsyncSession, match: Match) -> MatchSnapshot:
    """Replay every innings of a loaded match into its derived state."""
    squads = _group_squads(match)
    squad_refs = {
        team_id: [_player_ref(member) for member in members] for team_id, members in squads.items()
    }

    snapshots: list[InningsSnapshot] = []
    previous_totals: dict[int, int] = {}
    for innings in sorted(match.innings, key=lambda i: i.sequence):
        batting_id = str(innings.batting_team_id)
        bowling_id = str(innings.bowling_team_id)
        rules = _rules_for(match, innings, previous_totals)
        batting_refs = squad_refs.get(batting_id, [])
        bowling_refs = squad_refs.get(bowling_id, [])
        events = [_to_event(d) for d in sorted(innings.deliveries, key=lambda d: d.sequence)]
        state = build_innings_state(rules, batting_refs, bowling_refs, events)
        previous_totals[innings.sequence] = state.total_runs
        snapshots.append(
            InningsSnapshot(
                innings=innings,
                state=state,
                batting_team=match.team_a
                if match.team_a.id == innings.batting_team_id
                else match.team_b,
                bowling_team=match.team_a
                if match.team_a.id == innings.bowling_team_id
                else match.team_b,
                rules=rules,
                batting_refs=batting_refs,
                bowling_refs=bowling_refs,
                events=events,
            )
        )

    team_names = {str(match.team_a.id): match.team_a.name, str(match.team_b.id): match.team_b.name}
    outcome = determine_outcome(
        [
            InningsView(
                sequence=s.innings.sequence,
                batting_team_id=str(s.innings.batting_team_id),
                bowling_team_id=str(s.innings.bowling_team_id),
                state=s.state,
                is_super_over=s.innings.is_super_over,
            )
            for s in snapshots
        ],
        team_names=team_names,
        is_limited_overs=match.match_format is not MatchFormat.TEST,
    )
    return MatchSnapshot(match=match, innings=snapshots, squads=squads, outcome=outcome)


async def load_snapshot(
    session: AsyncSession,
    *,
    match_id: uuid.UUID | None = None,
    slug: str | None = None,
) -> MatchSnapshot:
    match = await load_match(session, match_id=match_id, slug=slug)
    return await build_snapshot(session, match)


def rules_for_innings(
    match: Match, innings: Innings, first_innings_runs: int | None
) -> InningsRules:
    """Public wrapper used by the scoring service when validating a new ball."""
    previous = {innings.sequence - 1: first_innings_runs} if first_innings_runs is not None else {}
    return _rules_for(match, innings, previous)


# -------------------------------------------------------------------- helpers


def _rules_for(match: Match, innings: Innings, previous_totals: dict[int, int]) -> InningsRules:
    target = innings.target_runs
    if target is None and match.match_format is not MatchFormat.TEST:
        # Any innings that follows another in a limited-overs match is a chase.
        previous_runs = previous_totals.get(innings.sequence - 1)
        if previous_runs is not None:
            target = compute_target(previous_runs)
    return InningsRules(
        balls_per_over=match.balls_per_over,
        overs_limit=innings.overs_limit if innings.overs_limit is not None else match.overs_limit,
        players_per_side=match.players_per_side,
        max_overs_per_bowler=match.max_overs_per_bowler,
        wide_penalty_runs=match.wide_penalty_runs,
        no_ball_penalty_runs=match.no_ball_penalty_runs,
        free_hit_after_no_ball=match.free_hit_after_no_ball,
        allow_boundaries=match.allow_boundaries,
        last_batter_can_bat_alone=match.last_batter_can_bat_alone,
        target_runs=target,
        innings_penalty_runs=innings.penalty_runs,
        forbid_consecutive_overs=not bool(
            match.rule_overrides.get("allow_consecutive_overs", False)
        ),
    )


def _to_event(delivery: Delivery) -> DeliveryEvent:
    return DeliveryEvent(
        id=str(delivery.id),
        sequence=delivery.sequence,
        striker_id=str(delivery.striker_id),
        non_striker_id=str(delivery.non_striker_id),
        bowler_id=str(delivery.bowler_id),
        batter_runs=delivery.batter_runs,
        extra_type=delivery.extra_type,
        extra_runs=delivery.extra_runs,
        is_boundary=delivery.is_boundary,
        batters_crossed=delivery.batters_crossed,
        is_wicket=delivery.is_wicket,
        wicket_type=delivery.wicket_type,
        dismissed_player_id=str(delivery.dismissed_player_id)
        if delivery.dismissed_player_id
        else None,
        fielder_id=str(delivery.fielder_id) if delivery.fielder_id else None,
        replacement_batter_id=str(delivery.replacement_batter_id)
        if delivery.replacement_batter_id
        else None,
        commentary=delivery.commentary,
    )


def _player_ref(member: MatchPlayer) -> PlayerRef:
    return PlayerRef(
        id=str(member.id),
        name=member.name,
        batting_order=member.batting_order,
        is_playing=member.is_playing,
    )


def _group_squads(match: Match) -> dict[str, list[MatchPlayer]]:
    grouped: dict[str, list[MatchPlayer]] = {
        str(match.team_a_id): [],
        str(match.team_b_id): [],
    }
    for member in sorted(match.squad, key=lambda m: m.batting_order):
        grouped.setdefault(str(member.team_id), []).append(member)
    return grouped


def _team_dict(team: Team) -> dict[str, Any]:
    return {
        "id": str(team.id),
        "name": team.name,
        "short_name": team.display_short_name,
        "logo_url": team.logo_url,
        "primary_color": team.primary_color,
    }


def _squad_member_dict(member: MatchPlayer) -> dict[str, Any]:
    photo_url = None
    if member.player is not None:
        photo_url = member.player.photo_url
    return {
        "id": str(member.id),
        "player_id": str(member.player_id) if member.player_id else None,
        "team_id": str(member.team_id),
        "name": member.name,
        "batting_order": member.batting_order,
        "is_captain": member.is_captain,
        "is_wicket_keeper": member.is_wicket_keeper,
        "is_playing": member.is_playing,
        "is_substitute": member.is_substitute,
        "photo_url": photo_url,
    }


def _photo_map(squads: dict[str, list[MatchPlayer]]) -> dict[str, dict[str, Any]]:
    mapping: dict[str, dict[str, Any]] = {}
    for members in squads.values():
        for member in members:
            player = member.player
            mapping[str(member.id)] = {
                "photo_url": player.photo_url if player is not None else None,
                "jersey_number": player.jersey_number if player is not None else None,
            }
    return mapping


def _batter_line(
    state: InningsState, player_id: str | None, photo_map: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any] | None:
    if not player_id:
        return None
    batter = state.batter(player_id)
    if batter is None:
        return None
    meta = (photo_map or {}).get(player_id) or {}
    return {
        "player_id": batter.player_id,
        "name": batter.name,
        "runs": batter.runs,
        "balls_faced": batter.balls_faced,
        "fours": batter.fours,
        "sixes": batter.sixes,
        "strike_rate": batter.strike_rate,
        "photo_url": meta.get("photo_url"),
        "jersey_number": meta.get("jersey_number"),
    }


def _bowler_line(
    state: InningsState, player_id: str | None, photo_map: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any] | None:
    if not player_id:
        return None
    bowler = state.bowler(player_id)
    if bowler is None:
        return None
    meta = (photo_map or {}).get(player_id) or {}
    return {
        "player_id": bowler.player_id,
        "name": bowler.name,
        "overs_text": bowler.overs_text,
        "runs_conceded": bowler.runs_conceded,
        "wickets": bowler.wickets,
        "economy": bowler.economy,
        "maidens": bowler.maidens,
        "photo_url": meta.get("photo_url"),
        "jersey_number": meta.get("jersey_number"),
    }


def is_scorable(match: Match) -> bool:
    return match.status in (MatchStatus.LIVE, MatchStatus.INNINGS_BREAK, MatchStatus.SETUP)
