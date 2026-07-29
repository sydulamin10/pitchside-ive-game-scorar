"""Match-level derivations: targets, results, and the human-readable summary.

Kept separate from the innings engine because these rules depend on the *set* of
innings rather than a single delivery log.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import MatchResultType
from app.scoring.types import InningsState


@dataclass(frozen=True, slots=True)
class InningsView:
    """One innings, reduced to what result determination needs."""

    sequence: int
    batting_team_id: str
    bowling_team_id: str
    state: InningsState
    is_super_over: bool = False


@dataclass(frozen=True, slots=True)
class MatchOutcome:
    result_type: MatchResultType | None
    winner_team_id: str | None
    margin_runs: int | None
    margin_wickets: int | None
    summary: str
    is_decided: bool


def compute_target(first_innings_runs: int) -> int:
    """Runs the chasing side needs to *win* (not to tie)."""
    return first_innings_runs + 1


def determine_outcome(
    innings: list[InningsView],
    *,
    team_names: dict[str, str],
    is_limited_overs: bool = True,
) -> MatchOutcome:
    """Decide the result of a match from its completed innings.

    Handles the ordinary two-innings limited-overs case exactly, plus super overs
    and multi-innings (Test-style) matches on aggregate runs.
    """
    if not innings:
        return MatchOutcome(None, None, None, None, "Match not started", False)

    super_overs = [i for i in innings if i.is_super_over]
    if len(super_overs) >= 2:
        outcome = _two_innings_outcome(
            super_overs[-2], super_overs[-1], team_names, super_over=True
        )
        if outcome.is_decided:
            return outcome

    regular = [i for i in innings if not i.is_super_over]
    if len(regular) == 2 and is_limited_overs:
        return _two_innings_outcome(regular[0], regular[1], team_names)
    if len(regular) > 2:
        return _aggregate_outcome(regular, team_names)
    if len(regular) == 1:
        first = regular[0]
        return MatchOutcome(
            None,
            None,
            None,
            None,
            f"{team_names.get(first.batting_team_id, 'Team')} "
            f"{first.state.total_runs}/{first.state.wickets} ({first.state.overs_text})",
            False,
        )
    return MatchOutcome(None, None, None, None, "Match not started", False)


def _two_innings_outcome(
    first: InningsView,
    second: InningsView,
    team_names: dict[str, str],
    *,
    super_over: bool = False,
) -> MatchOutcome:
    if not second.state.is_complete:
        return MatchOutcome(None, None, None, None, _in_progress_text(second, team_names), False)

    first_runs = first.state.total_runs
    second_runs = second.state.total_runs
    chasing = team_names.get(second.batting_team_id, "Team")
    defending = team_names.get(first.batting_team_id, "Team")
    result_type = MatchResultType.SUPER_OVER if super_over else MatchResultType.WIN

    if second_runs > first_runs:
        wickets_left = second.state.wickets_remaining
        margin = f"{wickets_left} wicket{'s' if wickets_left != 1 else ''}"
        balls_left = second.state.balls_remaining
        tail = (
            f" with {balls_left} ball{'s' if balls_left != 1 else ''} to spare"
            if balls_left
            else ""
        )
        return MatchOutcome(
            result_type,
            second.batting_team_id,
            None,
            wickets_left,
            f"{chasing} won by {margin}{tail}",
            True,
        )
    if second_runs < first_runs:
        margin_runs = first_runs - second_runs
        return MatchOutcome(
            result_type,
            first.batting_team_id,
            margin_runs,
            None,
            f"{defending} won by {margin_runs} run{'s' if margin_runs != 1 else ''}",
            True,
        )
    return MatchOutcome(
        MatchResultType.TIE,
        None,
        None,
        None,
        f"Match tied — {defending} {first_runs}, {chasing} {second_runs}",
        True,
    )


def _aggregate_outcome(innings: list[InningsView], team_names: dict[str, str]) -> MatchOutcome:
    totals: dict[str, int] = {}
    for view in innings:
        totals[view.batting_team_id] = totals.get(view.batting_team_id, 0) + view.state.total_runs
    if not all(view.state.is_complete for view in innings) or len(totals) < 2:
        return MatchOutcome(None, None, None, None, "Match in progress", False)

    (team_one, runs_one), (team_two, runs_two) = sorted(
        totals.items(), key=lambda kv: kv[1], reverse=True
    )[:2]
    if runs_one == runs_two:
        return MatchOutcome(MatchResultType.TIE, None, None, None, "Match tied", True)

    last = innings[-1]
    margin = runs_one - runs_two
    if last.batting_team_id == team_one:
        wickets_left = last.state.wickets_remaining
        return MatchOutcome(
            MatchResultType.WIN,
            team_one,
            None,
            wickets_left,
            f"{team_names.get(team_one, 'Team')} won by {wickets_left} wickets",
            True,
        )
    return MatchOutcome(
        MatchResultType.WIN,
        team_one,
        margin,
        None,
        f"{team_names.get(team_one, 'Team')} won by {margin} runs",
        True,
    )


def _in_progress_text(current: InningsView, team_names: dict[str, str]) -> str:
    state = current.state
    batting = team_names.get(current.batting_team_id, "Team")
    line = f"{batting} {state.total_runs}/{state.wickets} ({state.overs_text})"
    needed = state.runs_needed
    if needed and state.balls_remaining:
        return (
            f"{line} — need {needed} run{'s' if needed != 1 else ''} "
            f"from {state.balls_remaining} ball{'s' if state.balls_remaining != 1 else ''}"
        )
    return line
