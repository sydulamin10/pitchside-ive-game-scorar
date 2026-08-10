"""Career stats + player awards (requires TEST_DATABASE_URL)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock
import uuid

import pytest
from httpx import AsyncClient

from app.models.enums import ExtraType, WicketType
from app.services.career_stats import aggregate_from_deliveries
from tests.conftest import requires_db
from tests.test_api_flows import register

pytestmark = [requires_db, pytest.mark.integration]


def _delivery(
    *,
    innings_id: uuid.UUID,
    striker_id: uuid.UUID,
    non_striker_id: uuid.UUID,
    bowler_id: uuid.UUID,
    batter_runs: int = 0,
    is_boundary: bool = False,
    is_wicket: bool = False,
    wicket_type: WicketType | None = None,
    dismissed_player_id: uuid.UUID | None = None,
    fielder_id: uuid.UUID | None = None,
) -> MagicMock:
    d = MagicMock()
    d.innings_id = innings_id
    d.striker_id = striker_id
    d.non_striker_id = non_striker_id
    d.bowler_id = bowler_id
    d.batter_runs = batter_runs
    d.extra_type = None
    d.extra_runs = 0
    d.is_boundary = is_boundary
    d.is_wicket = is_wicket
    d.wicket_type = wicket_type
    d.dismissed_player_id = dismissed_player_id
    d.fielder_id = fielder_id
    return d


def test_career_stats_unit_aggregate() -> None:
    mp_batter = uuid.uuid4()
    mp_bowler = uuid.uuid4()
    mp_other = uuid.uuid4()
    innings_id = uuid.uuid4()
    match_id = uuid.uuid4()
    innings = MagicMock()
    innings.id = innings_id
    innings.match_id = match_id
    match = MagicMock()
    match.id = match_id
    match.public_slug = "demo"
    match.title = "A vs B"
    match.status = MagicMock(value="completed")
    match.completed_at = datetime.now(UTC)
    match.started_at = None
    match.scheduled_at = None
    match.created_at = datetime.now(UTC)

    deliveries = [
        _delivery(
            innings_id=innings_id,
            striker_id=mp_batter,
            non_striker_id=mp_other,
            bowler_id=mp_bowler,
            batter_runs=4,
            is_boundary=True,
        ),
        _delivery(
            innings_id=innings_id,
            striker_id=mp_batter,
            non_striker_id=mp_other,
            bowler_id=mp_bowler,
            batter_runs=6,
            is_boundary=True,
        ),
        _delivery(
            innings_id=innings_id,
            striker_id=mp_batter,
            non_striker_id=mp_other,
            bowler_id=mp_bowler,
            batter_runs=0,
            is_wicket=True,
            wicket_type=WicketType.CAUGHT,
            dismissed_player_id=mp_batter,
            fielder_id=mp_bowler,
        ),
    ]
    stats = aggregate_from_deliveries(
        match_player_ids={mp_batter},
        deliveries=deliveries,
        innings_by_id={innings_id: innings},
        matches_by_id={match_id: match},
    )
    assert stats["batting"]["runs"] == 10
    assert stats["batting"]["fours"] == 1
    assert stats["batting"]["sixes"] == 1
    assert "fifties" in stats["batting"]
    assert "hundreds" in stats["batting"]


async def test_awards_crud_and_public_stats(api: AsyncClient, db: Any) -> None:
    owner = await register(api)
    created = await api.post(
        "/teams",
        json={
            "name": "Awards XI",
            "short_name": "AWX",
            "players": [{"name": "Ali", "role": "batter"}],
        },
        headers=owner["headers"],
    )
    assert created.status_code == 201, created.text
    team = created.json()
    player = team["players"][0]

    award = await api.post(
        f"/teams/{team['id']}/players/{player['id']}/awards",
        json={
            "kind": "trophy",
            "title": "Player of the Match",
            "description": "Final",
            "awarded_at": datetime.now(UTC).isoformat(),
        },
        headers=owner["headers"],
    )
    assert award.status_code == 201, award.text
    assert award.json()["kind"] == "trophy"
    assert award.json()["team_id"] == team["id"]

    public = await api.get(f"/public/players/{player['public_slug']}/awards")
    assert public.status_code == 200, public.text
    assert len(public.json()) == 1
    assert public.json()[0]["title"] == "Player of the Match"

    stats = await api.get(f"/public/players/{player['public_slug']}/stats?last_n=5")
    assert stats.status_code == 200, stats.text
    body = stats.json()
    assert body["player_id"] == player["id"]
    assert "batting" in body
    assert "bowling" in body

    qr = await api.get(f"/public/players/{player['public_slug']}/qr")
    assert qr.status_code == 200
    assert "svg" in qr.headers.get("content-type", "")
    assert b"<svg" in qr.content
