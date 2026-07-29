"""Runs the shared cricket specification against the Python scoring engine."""

from __future__ import annotations

from typing import Any

import pytest

from app.core.errors import RuleViolation
from app.scoring import (
    PointsConfig,
    TeamMatchRecord,
    compute_standings,
    validate_delivery,
)
from tests.fixture_runner import (
    SPEC,
    assert_matches,
    build_candidate,
    case_setup,
    replay_case,
)


def _ids(cases: list[dict[str, Any]]) -> list[str]:
    return [case["name"] for case in cases]


@pytest.mark.parametrize("case", SPEC["cases"], ids=_ids(SPEC["cases"]))
def test_innings_replay(case: dict[str, Any]) -> None:
    state, _ = replay_case(case)
    assert not state.warnings, f"{case['name']}: unexpected warnings {state.warnings}"
    assert_matches(state, case["expect"], case["name"])


@pytest.mark.parametrize("case", SPEC["validation_cases"], ids=_ids(SPEC["validation_cases"]))
def test_delivery_validation(case: dict[str, Any]) -> None:
    rules, batting, bowling, _ = case_setup(case)
    state, _ = replay_case(case)
    candidate = build_candidate(case, state)

    with pytest.raises(RuleViolation) as excinfo:
        validate_delivery(state, candidate, rules, batting, bowling)
    assert excinfo.value.code == case["expect_error"], (
        f"{case['name']}: expected error code {case['expect_error']!r}, "
        f"got {excinfo.value.code!r} ({excinfo.value.message})"
    )


@pytest.mark.parametrize("case", SPEC["standings_cases"], ids=_ids(SPEC["standings_cases"]))
def test_standings(case: dict[str, Any]) -> None:
    config = PointsConfig(**case["config"])
    records = [
        TeamMatchRecord(
            team_id=row["team_id"],
            match_id=row["match_id"],
            outcome=row["outcome"],
            runs_scored=row.get("runs_scored", 0),
            overs_faced=row.get("overs_faced", 0.0),
            runs_conceded=row.get("runs_conceded", 0),
            overs_bowled=row.get("overs_bowled", 0.0),
            counts_for_run_rate=row.get("counts_for_run_rate", True),
        )
        for row in case["records"]
    ]
    standings = compute_standings(records, config=config, team_names=case.get("team_names", {}))
    rows = [row.to_dict() for row in standings]
    expected = case["expect"]
    assert len(rows) == len(expected), f"{case['name']}: row count mismatch: {rows}"
    for index, want in enumerate(expected):
        for key, value in want.items():
            got = rows[index].get(key)
            assert got == value, (
                f"{case['name']}: row {index} ({rows[index]['team_id']}).{key} "
                f"expected {value!r}, got {got!r}"
            )


def test_every_delivery_appends_deterministically() -> None:
    """Replaying a prefix then extending must equal replaying the whole log.

    This is the property the whole "edit any ball" feature rests on.
    """
    from app.scoring import build_innings_state

    case = next(c for c in SPEC["cases"] if c["name"].startswith("a mixed over"))
    rules, batting, bowling, _ = case_setup(case)
    _, events = replay_case(case)

    for cut in range(len(events) + 1):
        prefix = build_innings_state(rules, batting, bowling, events[:cut])
        again = build_innings_state(rules, batting, bowling, list(events[:cut]))
        assert prefix.to_dict() == again.to_dict()
