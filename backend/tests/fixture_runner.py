"""Shared harness for ``spec/scoring-fixtures.json``.

The fixture file is the executable specification of the laws of cricket as this
product implements them. The same file is consumed by the TypeScript engine in
``frontend/src/lib/scoring``, which is what keeps offline scoring in the browser
numerically identical to the server.

Deliveries in the fixtures omit the striker/non-striker whenever they follow from
the previous ball, so the harness replays incrementally and asks the engine who
is on strike before appending the next delivery. A rotation bug therefore shows
up as runs credited to the wrong batter, which the per-batter expectations catch.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from app.models.enums import ExtraType, WicketType
from app.scoring import (
    DeliveryEvent,
    InningsRules,
    InningsState,
    PlayerRef,
    build_innings_state,
)

SPEC_PATH = Path(__file__).resolve().parents[2] / "spec" / "scoring-fixtures.json"


def load_spec() -> dict[str, Any]:
    with SPEC_PATH.open(encoding="utf-8") as handle:
        data: dict[str, Any] = json.load(handle)
    return data


SPEC = load_spec()


def _players(raw: list[dict[str, Any]]) -> list[PlayerRef]:
    return [
        PlayerRef(
            id=item["id"],
            name=item["name"],
            batting_order=item.get("batting_order", 0),
            is_playing=item.get("is_playing", True),
        )
        for item in raw
    ]


def case_setup(
    case: dict[str, Any],
) -> tuple[InningsRules, list[PlayerRef], list[PlayerRef], list[str]]:
    defaults = SPEC["defaults"]
    rules_raw = {**defaults["rules"], **case.get("rules", {})}
    rules = InningsRules(**rules_raw)
    batting = _players(case.get("batting", defaults["batting"]))
    bowling = _players(case.get("bowling", defaults["bowling"]))
    bowlers = case.get("bowlers", defaults["bowlers"])
    return rules, batting, bowling, bowlers


def build_event(
    raw: dict[str, Any],
    *,
    index: int,
    state: InningsState | None,
    bowler_rotation: list[str],
) -> DeliveryEvent:
    """Turn one compact fixture entry into a full :class:`DeliveryEvent`."""
    striker = raw.get("striker") or (state.striker_id if state else None)
    non_striker = raw.get("non_striker") or (state.non_striker_id if state else None)
    if striker is None or non_striker is None:
        raise AssertionError(
            f"Fixture delivery #{index + 1} needs an explicit striker/non_striker: "
            "no batter is at that end."
        )

    bowler = raw.get("bowler")
    if bowler is None and state is not None:
        bowler = state.current_bowler_id
    if bowler is None:
        over_index = (state.legal_balls // state.balls_per_over) if state else 0
        bowler = bowler_rotation[over_index % len(bowler_rotation)]

    wicket = raw.get("wicket")
    return DeliveryEvent(
        id=raw.get("id", f"d{index + 1}"),
        sequence=index + 1,
        striker_id=striker,
        non_striker_id=non_striker,
        bowler_id=bowler,
        batter_runs=raw.get("runs", 0),
        extra_type=ExtraType(raw["extra"]) if raw.get("extra") else None,
        extra_runs=raw.get("extra_runs", 0),
        is_boundary=raw.get("boundary", False),
        batters_crossed=raw.get("crossed"),
        is_wicket=wicket is not None,
        wicket_type=WicketType(wicket) if wicket else None,
        dismissed_player_id=raw.get("out"),
        fielder_id=raw.get("fielder"),
        replacement_batter_id=raw.get("new_batter"),
        commentary=raw.get("commentary"),
    )


def replay_case(case: dict[str, Any]) -> tuple[InningsState, list[DeliveryEvent]]:
    """Incrementally build the delivery list, then return the final state."""
    rules, batting, bowling, bowler_rotation = case_setup(case)
    events: list[DeliveryEvent] = []
    state: InningsState | None = None
    for index, raw in enumerate(case["deliveries"]):
        event = build_event(raw, index=index, state=state, bowler_rotation=bowler_rotation)
        events.append(event)
        state = build_innings_state(rules, batting, bowling, events)
    if state is None:
        state = build_innings_state(rules, batting, bowling, [])
    return state, events


def build_candidate(case: dict[str, Any], state: InningsState) -> DeliveryEvent:
    """Build the not-yet-appended delivery used by the validation fixtures."""
    _, _, _, bowler_rotation = case_setup(case)
    raw = case["candidate"]
    event = build_event(
        raw,
        index=len(case["deliveries"]),
        state=state,
        bowler_rotation=bowler_rotation,
    )
    # Validation fixtures deliberately probe illegal personnel, so honour the
    # literal values when they are given.
    overrides: dict[str, Any] = {}
    if "striker" in raw:
        overrides["striker_id"] = raw["striker"]
    if "non_striker" in raw:
        overrides["non_striker_id"] = raw["non_striker"]
    if "bowler" in raw:
        overrides["bowler_id"] = raw["bowler"]
    return replace(event, **overrides) if overrides else event


# --------------------------------------------------------------------- asserts


def assert_matches(state: InningsState, expected: dict[str, Any], label: str) -> None:
    """Subset-compare the engine output against a fixture's expectations."""
    actual = state.to_dict()

    for key, want in expected.items():
        if key in ("batting", "bowling", "extras", "fall_of_wickets", "partnerships"):
            continue
        got = actual.get(key)
        assert got == want, f"{label}: {key} expected {want!r}, got {got!r}"

    if "extras" in expected:
        for key, want in expected["extras"].items():
            got = actual["extras"].get(key)
            assert got == want, f"{label}: extras.{key} expected {want!r}, got {got!r}"

    if "batting" in expected:
        by_id = {row["player_id"]: row for row in actual["batting"]}
        for player_id, fields in expected["batting"].items():
            assert player_id in by_id, f"{label}: batter {player_id} missing from the card"
            for key, want in fields.items():
                got = by_id[player_id].get(key)
                assert got == want, (
                    f"{label}: batting[{player_id}].{key} expected {want!r}, got {got!r}"
                )

    if "bowling" in expected:
        by_id = {row["player_id"]: row for row in actual["bowling"]}
        if not expected["bowling"]:
            assert not actual["bowling"], (
                f"{label}: expected no bowling figures, got {by_id.keys()}"
            )
        for player_id, fields in expected["bowling"].items():
            assert player_id in by_id, f"{label}: bowler {player_id} missing from the card"
            for key, want in fields.items():
                got = by_id[player_id].get(key)
                assert got == want, (
                    f"{label}: bowling[{player_id}].{key} expected {want!r}, got {got!r}"
                )

    for list_key in ("fall_of_wickets", "partnerships"):
        if list_key not in expected:
            continue
        want_rows = expected[list_key]
        got_rows = actual[list_key]
        assert len(got_rows) == len(want_rows), (
            f"{label}: {list_key} expected {len(want_rows)} rows, got {len(got_rows)}: {got_rows}"
        )
        for index, want_row in enumerate(want_rows):
            for key, want in want_row.items():
                got = got_rows[index].get(key)
                assert got == want, (
                    f"{label}: {list_key}[{index}].{key} expected {want!r}, got {got!r}"
                )
