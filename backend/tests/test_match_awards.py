"""Unit tests for match awards projection."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.models.enums import WicketType
from app.scoring.types import BatterInnings, BatterStatus, BowlerInnings, InningsState
from app.services.match_awards import compute_match_awards


def test_compute_match_awards_picks_best_roles() -> None:
    batting = [
        BatterInnings(
            player_id="b1",
            name="Ali",
            runs=80,
            balls_faced=50,
            fours=8,
            sixes=3,
            status=BatterStatus.OUT,
            wicket_type=WicketType.CAUGHT,
            fielder_id="f1",
            fielder_name="Farid",
        ),
        BatterInnings(
            player_id="b2",
            name="Bilal",
            runs=20,
            balls_faced=30,
            status=BatterStatus.NOT_OUT,
        ),
    ]
    bowling = [
        BowlerInnings(player_id="w1", name="Wasim", balls_bowled=24, runs_conceded=18, wickets=3),
        BowlerInnings(player_id="w2", name="Imran", balls_bowled=24, runs_conceded=40, wickets=1),
    ]
    state = InningsState(total_runs=120, wickets=5, batting=batting, bowling=bowling, overs=[])
    innings = SimpleNamespace(
        innings=SimpleNamespace(sequence=1),
        state=state,
        batting_team=SimpleNamespace(name="Team A"),
        bowling_team=SimpleNamespace(name="Team B"),
    )
    match = SimpleNamespace(result_summary="Team A won")
    snapshot = MagicMock()
    snapshot.match = match
    snapshot.outcome = SimpleNamespace(summary="Team A won")
    snapshot.innings = [innings]
    snapshot.squads = {
        "t1": [
            SimpleNamespace(id="b1", name="Ali", team_id="t1", player=None),
            SimpleNamespace(id="f1", name="Farid", team_id="t1", player=None),
            SimpleNamespace(id="w1", name="Wasim", team_id="t2", player=None),
        ]
    }

    awards = compute_match_awards(snapshot)
    assert awards["best_batter"]["name"] == "Ali"
    assert awards["best_bowler"]["name"] == "Wasim"
    assert awards["best_fielder"]["name"] == "Farid"
    assert awards["man_of_the_match"] is not None
    assert awards["mvp_ratings"]
