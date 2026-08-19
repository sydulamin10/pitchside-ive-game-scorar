"""Focused tests for mid-over bowler change and crease overrides."""

from __future__ import annotations

from app.scoring import (
    CreaseOverride,
    DeliveryEvent,
    InningsRules,
    PlayerRef,
    build_innings_state,
    validate_delivery,
)


def _players(prefix: str, count: int) -> list[PlayerRef]:
    return [
        PlayerRef(id=f"{prefix}{i}", name=f"{prefix.upper()}{i}", batting_order=i)
        for i in range(1, count + 1)
    ]


def _ball(
    sequence: int,
    *,
    striker: str,
    non_striker: str,
    bowler: str,
    runs: int = 0,
) -> DeliveryEvent:
    return DeliveryEvent(
        id=f"d{sequence}",
        sequence=sequence,
        striker_id=striker,
        non_striker_id=non_striker,
        bowler_id=bowler,
        batter_runs=runs,
    )


def test_mid_over_bowler_change_keeps_over_ball_count() -> None:
    batting = _players("a", 11)
    bowling = _players("p", 5)
    rules = InningsRules()
    events = [
        _ball(1, striker="a1", non_striker="a2", bowler="p1"),
        _ball(2, striker="a1", non_striker="a2", bowler="p1"),
        _ball(3, striker="a1", non_striker="a2", bowler="p1"),
        _ball(4, striker="a1", non_striker="a2", bowler="p1"),
    ]
    state = build_innings_state(rules, batting, bowling, events)
    assert state.overs_text == "0.4"
    assert state.current_bowler_id == "p1"

    candidate = _ball(5, striker="a1", non_striker="a2", bowler="p2", runs=1)
    validate_delivery(state, candidate, rules, batting, bowling)

    events.append(candidate)
    events.append(_ball(6, striker="a2", non_striker="a1", bowler="p2"))
    final = build_innings_state(rules, batting, bowling, events)
    assert final.overs_text == "1.0"
    assert final.legal_balls == 6
    assert final.current_bowler_id is None
    by_id = {b.player_id: b for b in final.bowling}
    assert by_id["p1"].balls_bowled == 4
    assert by_id["p2"].balls_bowled == 2
    assert by_id["p2"].runs_conceded == 1


def test_crease_swap_affects_projection_without_rewriting_history() -> None:
    batting = _players("a", 11)
    bowling = _players("p", 5)
    rules = InningsRules()
    events = [
        _ball(1, striker="a1", non_striker="a2", bowler="p1", runs=1),
        _ball(2, striker="a2", non_striker="a1", bowler="p1"),
    ]
    before = build_innings_state(rules, batting, bowling, events)
    assert before.striker_id == "a2"
    assert before.non_striker_id == "a1"

    swapped = build_innings_state(
        rules,
        batting,
        bowling,
        events,
        crease=CreaseOverride(
            after_sequence=2,
            striker_id="a1",
            non_striker_id="a2",
            bowler_id="p1",
        ),
    )
    assert swapped.striker_id == "a1"
    assert swapped.non_striker_id == "a2"
    assert swapped.legal_balls == before.legal_balls
    assert swapped.total_runs == before.total_runs
    # Historical ball facts are unchanged.
    assert events[0].striker_id == "a1"
    assert events[1].striker_id == "a2"


def test_crease_bowler_override_mid_over() -> None:
    batting = _players("a", 11)
    bowling = _players("p", 5)
    rules = InningsRules()
    events = [
        _ball(1, striker="a1", non_striker="a2", bowler="p1"),
        _ball(2, striker="a1", non_striker="a2", bowler="p1"),
        _ball(3, striker="a1", non_striker="a2", bowler="p1"),
        _ball(4, striker="a1", non_striker="a2", bowler="p1"),
    ]
    state = build_innings_state(
        rules,
        batting,
        bowling,
        events,
        crease=CreaseOverride(after_sequence=4, bowler_id="p2", striker_id="a1", non_striker_id="a2"),
    )
    assert state.overs_text == "0.4"
    assert state.current_bowler_id == "p2"
