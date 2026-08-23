"""End-to-end API flows against a real Postgres.

These exercise the paths a scorer actually walks: sign up, build a match, score
an over, correct a mistake, finish the chase, publish it, and roll the result
into a points table. They are deliberately written against the HTTP surface
rather than the services, because that is the contract the app and any future
client depend on.

Skipped automatically when ``TEST_DATABASE_URL`` is not set.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import requires_db

pytestmark = [requires_db, pytest.mark.integration]

PASSWORD = "Sc0rer!Passphrase"

BATTERS = ["Rohit", "Gill", "Kohli", "Pant", "Surya", "Hardik", "Jadeja", "Axar"]
BOWLERS = ["Starc", "Cummins", "Hazlewood", "Zampa", "Maxwell", "Head", "Marsh", "Green"]


# --------------------------------------------------------------------- helpers


async def register(api: AsyncClient, *, display_name: str = "Test Scorer") -> dict[str, Any]:
    email = f"scorer-{uuid.uuid4().hex[:10]}@example.org"
    response = await api.post(
        "/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": display_name},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    body["email"] = email
    body["headers"] = {"Authorization": f"Bearer {body['access_token']}"}
    return body


def _squad(names: list[str]) -> list[dict[str, Any]]:
    return [{"name": name, "batting_order": order} for order, name in enumerate(names, start=1)]


async def create_match(
    api: AsyncClient,
    headers: dict[str, str],
    *,
    overs_limit: int = 2,
    players_per_side: int = 8,
    tournament_id: str | None = None,
    team_a_name: str = "India",
    team_b_name: str = "Australia",
) -> dict[str, Any]:
    """A short match, so a full chase fits inside a test."""
    payload: dict[str, Any] = {
        "title": f"{team_a_name} vs {team_b_name}",
        "venue": "Wankhede",
        "match_format": "t20",
        "rules": {
            "overs_limit": overs_limit,
            "balls_per_over": 6,
            "players_per_side": players_per_side,
        },
        "team_a": {"name": team_a_name, "short_name": "IND", "players": _squad(BATTERS)},
        "team_b": {"name": team_b_name, "short_name": "AUS", "players": _squad(BOWLERS)},
    }
    if tournament_id is not None:
        payload["tournament_id"] = tournament_id
    response = await api.post("/matches", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def squad_ids(snapshot: dict[str, Any], team_key: str) -> list[str]:
    team_id = snapshot["match"]["teams"][team_key]["id"]
    return [member["id"] for member in snapshot["squads"][team_id]]


async def start_toss_and_innings(
    api: AsyncClient, headers: dict[str, str], snapshot: dict[str, Any]
) -> dict[str, Any]:
    match_id = snapshot["match"]["id"]
    team_a_id = snapshot["match"]["teams"]["a"]["id"]
    toss = await api.patch(
        f"/matches/{match_id}",
        json={"toss": {"winner_team_id": team_a_id, "decision": "bat"}},
        headers=headers,
    )
    assert toss.status_code == 200, toss.text
    started = await api.post(f"/matches/{match_id}/innings", json={}, headers=headers)
    assert started.status_code == 201, started.text
    return started.json()


async def record(
    api: AsyncClient,
    headers: dict[str, str],
    match_id: str,
    ball: dict[str, Any],
    *,
    expect: int = 200,
) -> dict[str, Any]:
    response = await api.post(f"/matches/{match_id}/deliveries", json=ball, headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def current_innings(snapshot: dict[str, Any]) -> dict[str, Any]:
    return next(i for i in snapshot["innings"] if i["id"] == snapshot["current_innings_id"])


def ends(snapshot: dict[str, Any]) -> tuple[str, str]:
    """Who is at the crease, according to the replay.

    A fresh innings has nobody in yet, so the openers are taken from the batting
    side's order — which is exactly what a scoring app has to do.
    """
    innings = current_innings(snapshot)
    state = innings["state"]
    if state["striker_id"] and state["non_striker_id"]:
        return state["striker_id"], state["non_striker_id"]
    members = snapshot["squads"][innings["batting_team_id"]]
    return members[0]["id"], members[1]["id"]


def batter(innings_state: dict[str, Any], player_id: str) -> dict[str, Any]:
    return next(b for b in innings_state["batting"] if b["player_id"] == player_id)


async def bat_out_over(
    api: AsyncClient,
    headers: dict[str, str],
    match_id: str,
    *,
    bowler_id: str,
    runs_per_ball: int = 0,
    balls: int = 6,
    state: dict[str, Any],
) -> dict[str, Any]:
    """Bowl ``balls`` legal deliveries, letting the server keep the ends right."""
    for _ in range(balls):
        striker, non_striker = ends(state)
        payload = await record(
            api,
            headers,
            match_id,
            {
                "striker_id": striker,
                "non_striker_id": non_striker,
                "bowler_id": bowler_id,
                "batter_runs": runs_per_ball,
                "client_event_id": str(uuid.uuid4()),
            },
        )
        state = payload["state"]
    return state


# ------------------------------------------------------------------------ auth


async def test_registration_issues_a_working_session(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    assert account["token_type"] == "bearer"
    assert account["refresh_token"]
    assert account["user"]["email"] == account["email"]

    me = await api.get("/users/me", headers=account["headers"])
    assert me.status_code == 200, me.text
    assert me.json()["email"] == account["email"]


async def test_the_same_email_cannot_register_twice(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    again = await api.post(
        "/auth/register",
        json={
            "email": account["email"].upper(),
            "password": PASSWORD,
            "display_name": "Impostor",
        },
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "email_taken"


async def test_login_is_case_insensitive_and_rejects_a_wrong_password(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)

    good = await api.post(
        "/auth/login", json={"email": account["email"].upper(), "password": PASSWORD}
    )
    assert good.status_code == 200, good.text

    bad = await api.post("/auth/login", json={"email": account["email"], "password": "wrong-pass"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "invalid_credentials"


async def test_a_refresh_token_rotates_and_the_old_one_dies(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    first = account["refresh_token"]

    rotated = await api.post("/auth/refresh", json={"refresh_token": first})
    assert rotated.status_code == 200, rotated.text
    second = rotated.json()["refresh_token"]
    assert second != first

    replayed = await api.post("/auth/refresh", json={"refresh_token": first})
    assert replayed.status_code == 401
    assert replayed.json()["error"]["code"] == "token_reused"

    # Reuse detection is a breach signal, so the whole family is revoked.
    dead = await api.post("/auth/refresh", json={"refresh_token": second})
    assert dead.status_code == 401


async def test_signing_out_invalidates_the_access_token_immediately(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    headers = account["headers"]

    assert (await api.get("/users/me", headers=headers)).status_code == 200

    out = await api.post("/auth/logout", json={"refresh_token": account["refresh_token"]})
    assert out.status_code == 200, out.text

    after = await api.get("/users/me", headers=headers)
    assert after.status_code == 401
    assert after.json()["error"]["code"] == "session_revoked"


async def test_a_weak_password_is_refused_with_a_useful_message(api: AsyncClient, db: Any) -> None:
    response = await api.post(
        "/auth/register",
        json={
            "email": f"weak-{uuid.uuid4().hex[:8]}@example.org",
            "password": "password123",
            "display_name": "Weak",
        },
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "weak_password"
    assert response.json()["error"]["details"]["reason"] == "common_password"


# ----------------------------------------------------------------------- teams


async def test_a_team_carries_its_roster_and_stays_private(api: AsyncClient, db: Any) -> None:
    owner = await register(api)
    stranger = await register(api)

    created = await api.post(
        "/teams",
        json={
            "name": "Sunday Reserves",
            "short_name": "SRV",
            "players": [{"name": "Ali", "role": "batter"}, {"name": "Ben", "role": "bowler"}],
        },
        headers=owner["headers"],
    )
    assert created.status_code == 201, created.text
    team = created.json()
    assert len(team["players"]) == 2

    mine = await api.get("/teams", headers=owner["headers"])
    assert [t["id"] for t in mine.json()] == [team["id"]]

    theirs = await api.get("/teams", headers=stranger["headers"])
    assert theirs.json() == []

    peek = await api.get(f"/teams/{team['id']}", headers=stranger["headers"])
    assert peek.status_code in (403, 404)


async def test_removing_a_player_keeps_the_roster_clean(api: AsyncClient, db: Any) -> None:
    owner = await register(api)
    team = (
        await api.post(
            "/teams",
            json={"name": "Rovers", "players": [{"name": "Ali"}, {"name": "Ben"}]},
            headers=owner["headers"],
        )
    ).json()
    player_id = team["players"][0]["id"]

    removed = await api.delete(f"/teams/{team['id']}/players/{player_id}", headers=owner["headers"])
    assert removed.status_code == 200, removed.text

    after = await api.get(f"/teams/{team['id']}", headers=owner["headers"])
    assert [p["id"] for p in after.json()["players"]] == [team["players"][1]["id"]]


# --------------------------------------------------------------------- matches


async def test_creating_a_match_builds_both_squads_and_a_share_link(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])

    assert snapshot["match"]["status"] == "setup"
    assert snapshot["match"]["slug"]
    assert snapshot["match"]["share_url"].endswith(snapshot["match"]["slug"])
    assert len(squad_ids(snapshot, "a")) == len(BATTERS)
    assert len(squad_ids(snapshot, "b")) == len(BOWLERS)
    assert snapshot["innings"] == []


async def test_tennis_ball_match_with_named_sides_only(api: AsyncClient, db: Any) -> None:
    """Walk-up sides with no roster, the payload the ODCC create form sends."""
    account = await register(api)
    response = await api.post(
        "/matches",
        json={
            "title": "Old Dhaka Champion League",
            "venue": "Old Dhaka Cricket Stadium",
            "match_format": "tennis_ball",
            "rules": {
                "overs_limit": 12,
                "balls_per_over": 6,
                "players_per_side": 11,
                "max_overs_per_bowler": None,
                "dls_enabled": True,
            },
            "team_a": {"name": "A", "short_name": "a"},
            "team_b": {"name": "B", "short_name": "b"},
            "tournament_id": None,
        },
        headers=account["headers"],
    )
    assert response.status_code == 201, response.text
    snapshot = response.json()
    assert snapshot["match"]["format"] == "tennis_ball"
    assert snapshot["match"]["status"] == "setup"
    assert snapshot["innings"] == []
    assert snapshot["match"]["teams"]["a"]["name"] == "A"
    assert snapshot["match"]["teams"]["b"]["name"] == "B"


async def test_naming_no_squad_uses_the_saved_roster(api: AsyncClient, db: Any) -> None:
    """Picking saved teams and saying nothing about players means "the usual XI"."""
    account = await register(api)
    headers = account["headers"]
    saved = []
    for name in ("Rovers", "Wanderers"):
        created = await api.post(
            "/teams",
            json={"name": name, "players": [{"name": f"{name} {i}"} for i in range(1, 4)]},
            headers=headers,
        )
        assert created.status_code == 201, created.text
        saved.append(created.json())

    response = await api.post(
        "/matches",
        json={
            "rules": {"overs_limit": 2, "players_per_side": 3},
            "team_a": {"team_id": saved[0]["id"]},
            "team_b": {"team_id": saved[1]["id"]},
            "toss": {"winner_team_id": saved[0]["id"], "decision": "bat"},
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    snapshot = response.json()
    assert len(squad_ids(snapshot, "a")) == 3
    assert len(squad_ids(snapshot, "b")) == 3

    # The point of the default: the match is scoreable straight away.
    started = await api.post(
        f"/matches/{snapshot['match']['id']}/innings", json={}, headers=headers
    )
    assert started.status_code == 201, started.text


async def test_an_innings_cannot_start_before_the_toss(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])

    response = await api.post(
        f"/matches/{snapshot['match']['id']}/innings", json={}, headers=account["headers"]
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "toss_required"


async def test_the_toss_decides_who_bats_first(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    team_b_id = snapshot["match"]["teams"]["b"]["id"]

    await api.patch(
        f"/matches/{snapshot['match']['id']}",
        json={"toss": {"winner_team_id": team_b_id, "decision": "bowl"}},
        headers=account["headers"],
    )
    started = await api.post(
        f"/matches/{snapshot['match']['id']}/innings", json={}, headers=account["headers"]
    )
    assert started.status_code == 201, started.text
    body = started.json()
    # The toss winner chose to bowl, so the other side bats.
    assert body["innings"][0]["batting_team_id"] == snapshot["match"]["teams"]["a"]["id"]
    assert body["match"]["status"] == "live"


async def test_a_stranger_cannot_see_or_score_someone_elses_match(
    api: AsyncClient, db: Any
) -> None:
    owner = await register(api)
    stranger = await register(api)
    snapshot = await create_match(api, owner["headers"])
    match_id = snapshot["match"]["id"]

    assert (await api.get(f"/matches/{match_id}", headers=stranger["headers"])).status_code == 403
    blocked = await api.post(
        f"/matches/{match_id}/deliveries",
        json={
            "striker_id": squad_ids(snapshot, "a")[0],
            "non_striker_id": squad_ids(snapshot, "a")[1],
            "bowler_id": squad_ids(snapshot, "b")[0],
        },
        headers=stranger["headers"],
    )
    assert blocked.status_code == 403


async def test_a_viewer_collaborator_can_read_but_not_write(api: AsyncClient, db: Any) -> None:
    owner = await register(api)
    guest = await register(api)
    snapshot = await create_match(api, owner["headers"])
    match_id = snapshot["match"]["id"]

    invited = await api.post(
        f"/matches/{match_id}/collaborators",
        json={"email": guest["email"], "role": "viewer"},
        headers=owner["headers"],
    )
    assert invited.status_code == 201, invited.text

    assert (await api.get(f"/matches/{match_id}", headers=guest["headers"])).status_code == 200
    denied = await api.patch(
        f"/matches/{match_id}", json={"venue": "Hijacked"}, headers=guest["headers"]
    )
    assert denied.status_code == 403


async def test_a_scorer_collaborator_can_record_a_ball(api: AsyncClient, db: Any) -> None:
    owner = await register(api)
    helper = await register(api)
    snapshot = await create_match(api, owner["headers"])
    match_id = snapshot["match"]["id"]

    await api.post(
        f"/matches/{match_id}/collaborators",
        json={"email": helper["email"], "role": "scorer"},
        headers=owner["headers"],
    )
    live = await start_toss_and_innings(api, owner["headers"], snapshot)
    striker, non_striker = ends(live)

    scored = await record(
        api,
        helper["headers"],
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "batter_runs": 4,
        },
    )
    assert current_innings(scored["state"])["state"]["total_runs"] == 4


# --------------------------------------------------------------------- scoring


async def test_an_over_of_singles_rotates_the_strike_correctly(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    batters = squad_ids(snapshot, "a")
    bowlers = squad_ids(snapshot, "b")

    live = await start_toss_and_innings(api, account["headers"], snapshot)
    state = await bat_out_over(
        api, account["headers"], match_id, bowler_id=bowlers[0], runs_per_ball=1, state=live
    )

    innings = current_innings(state)["state"]
    assert innings["total_runs"] == 6
    assert innings["overs_text"] == "1.0"
    # Six singles swap the strike six times, then the change of ends at the end
    # of the over swaps it once more.
    assert innings["striker_id"] == batters[1]
    assert innings["non_striker_id"] == batters[0]
    assert innings["next_action"] == "select_bowler"


async def test_swap_ends_exchanges_striker_for_future_balls(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)
    bowler = squad_ids(snapshot, "b")[0]

    after_dot = await record(
        api,
        account["headers"],
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": bowler,
            "batter_runs": 0,
        },
    )
    before = current_innings(after_dot)["state"]
    swapped = await api.post(
        f"/matches/{match_id}/crease/swap-ends",
        json={},
        headers=account["headers"],
    )
    assert swapped.status_code == 200, swapped.text
    after = current_innings(swapped.json()["state"])["state"]
    assert after["striker_id"] == before["non_striker_id"]
    assert after["non_striker_id"] == before["striker_id"]


async def test_a_wide_adds_a_run_without_a_ball(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)

    result = await record(
        api,
        account["headers"],
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "extra_type": "wide",
            "extra_runs": 0,
        },
    )
    innings = current_innings(result["state"])["state"]
    assert innings["total_runs"] == 1
    assert innings["legal_balls"] == 0
    assert innings["extras"]["wide"] == 1
    assert batter(innings, striker)["balls_faced"] == 0


async def test_a_no_ball_sets_up_a_free_hit(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)

    result = await record(
        api,
        account["headers"],
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "extra_type": "no_ball",
            "batter_runs": 2,
        },
    )
    innings = current_innings(result["state"])["state"]
    assert innings["total_runs"] == 3
    assert innings["is_free_hit"] is True

    # On a free hit only a run-out can dismiss the batter.
    refused = await api.post(
        f"/matches/{match_id}/deliveries",
        json={
            "striker_id": innings["striker_id"],
            "non_striker_id": innings["non_striker_id"],
            "bowler_id": squad_ids(snapshot, "b")[0],
            "is_wicket": True,
            "wicket_type": "bowled",
        },
        headers=account["headers"],
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "wicket_illegal_on_free_hit"


async def test_a_wicket_brings_in_the_next_batter(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    batters = squad_ids(snapshot, "a")
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)

    result = await record(
        api,
        account["headers"],
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "is_wicket": True,
            "wicket_type": "bowled",
        },
    )
    innings = current_innings(result["state"])["state"]
    assert innings["wickets"] == 1
    assert batter(innings, batters[0])["status"] == "out"
    assert batter(innings, batters[0])["dismissal_text"]
    assert innings["fall_of_wickets"][0]["wicket_number"] == 1
    assert innings["bowling"][0]["wickets"] == 1
    # The vacated end stays empty until the scorer names the incoming batter.
    assert innings["striker_id"] is None
    assert innings["next_action"] == "select_batter"
    assert batters[2] in innings["available_batter_ids"]

    # Naming him on the next ball is enough to bring him in.
    next_ball = await record(
        api,
        account["headers"],
        match_id,
        {
            "striker_id": batters[2],
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "batter_runs": 1,
        },
    )
    innings = current_innings(next_ball["state"])["state"]
    assert batter(innings, batters[2])["runs"] == 1
    assert innings["non_striker_id"] == batters[2]


async def test_the_same_bowler_cannot_bowl_consecutive_overs(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    bowlers = squad_ids(snapshot, "b")

    live = await start_toss_and_innings(api, account["headers"], snapshot)
    state = await bat_out_over(api, account["headers"], match_id, bowler_id=bowlers[0], state=live)

    striker, non_striker = ends(state)
    refused = await api.post(
        f"/matches/{match_id}/deliveries",
        json={
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": bowlers[0],
        },
        headers=account["headers"],
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "consecutive_overs"


async def test_replaying_a_client_event_id_is_a_no_op(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)

    ball = {
        "striker_id": striker,
        "non_striker_id": non_striker,
        "bowler_id": squad_ids(snapshot, "b")[0],
        "batter_runs": 4,
        "client_event_id": str(uuid.uuid4()),
    }
    first = await record(api, account["headers"], match_id, ball)
    second = await record(api, account["headers"], match_id, ball)

    assert first["result"]["accepted"] == 1
    assert second["result"]["duplicates"] == 1
    assert second["result"]["delivery_id"] == first["result"]["delivery_id"]
    assert current_innings(second["state"])["state"]["total_runs"] == 4


async def test_an_offline_queue_syncs_in_order_and_survives_a_partial_replay(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    batters = squad_ids(snapshot, "a")
    bowler = squad_ids(snapshot, "b")[0]
    await start_toss_and_innings(api, account["headers"], snapshot)

    queue = [
        {
            "striker_id": batters[0],
            "non_striker_id": batters[1],
            "bowler_id": bowler,
            "batter_runs": runs,
            "client_event_id": str(uuid.uuid4()),
        }
        for runs in (1, 0, 4, 0, 2, 6)
    ]
    synced = await api.post(
        f"/matches/{match_id}/deliveries/sync",
        json={"deliveries": queue},
        headers=account["headers"],
    )
    assert synced.status_code == 200, synced.text
    body = synced.json()
    assert body["result"]["accepted"] == 6
    assert current_innings(body["state"])["state"]["total_runs"] == 13

    # The phone came back online twice and sent the same queue again.
    resynced = await api.post(
        f"/matches/{match_id}/deliveries/sync",
        json={"deliveries": queue},
        headers=account["headers"],
    )
    replayed = resynced.json()
    assert replayed["result"]["accepted"] == 0
    assert replayed["result"]["duplicates"] == 6
    assert replayed["result"]["rejected"] == []
    assert current_innings(replayed["state"])["state"]["total_runs"] == 13


async def test_correcting_an_early_ball_fixes_every_later_number(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    batters = squad_ids(snapshot, "a")
    bowler = squad_ids(snapshot, "b")[0]
    live = await start_toss_and_innings(api, account["headers"], snapshot)

    # Three dots, then a four: 4 runs, all to the opening batter.
    state = live
    first_ball_id: str | None = None
    for runs in (0, 0, 0, 4):
        striker, non_striker = ends(state)
        result = await record(
            api,
            account["headers"],
            match_id,
            {
                "striker_id": striker,
                "non_striker_id": non_striker,
                "bowler_id": bowler,
                "batter_runs": runs,
            },
        )
        state = result["state"]
        first_ball_id = first_ball_id or result["result"]["delivery_id"]

    innings = current_innings(state)["state"]
    assert innings["total_runs"] == 4
    assert batter(innings, batters[0])["runs"] == 4
    assert batter(innings, batters[0])["balls_faced"] == 4

    # It was actually a single off the first ball, so the strike rotated and the
    # remaining balls belong to the other batter.
    corrected = await api.patch(
        f"/matches/{match_id}/deliveries/{first_ball_id}",
        json={"batter_runs": 1, "reason": "scorer miscounted the first ball"},
        headers=account["headers"],
    )
    assert corrected.status_code == 200, corrected.text
    innings = current_innings(corrected.json()["state"])["state"]

    assert innings["total_runs"] == 5
    assert batter(innings, batters[0])["runs"] == 1
    assert batter(innings, batters[0])["balls_faced"] == 1
    assert batter(innings, batters[1])["runs"] == 4
    assert batter(innings, batters[1])["balls_faced"] == 3

    revisions = await api.get(f"/matches/{match_id}/revisions", headers=account["headers"])
    assert revisions.status_code == 200
    entry = revisions.json()["items"][0]
    assert entry["change_kind"] == "edit"
    assert entry["previous_state"]["batter_runs"] == 0
    assert entry["new_state"]["batter_runs"] == 1
    assert entry["reason"] == "scorer miscounted the first ball"


async def test_undo_removes_the_last_ball_and_leaves_an_audit_trail(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)

    await record(
        api,
        account["headers"],
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "batter_runs": 6,
        },
    )
    undone = await api.post(f"/matches/{match_id}/undo", json={}, headers=account["headers"])
    assert undone.status_code == 200, undone.text
    innings = current_innings(undone.json()["state"])["state"]
    assert innings["total_runs"] == 0
    assert innings["legal_balls"] == 0

    deliveries = await api.get(f"/matches/{match_id}/deliveries", headers=account["headers"])
    assert deliveries.json()["total"] == 0

    revisions = await api.get(f"/matches/{match_id}/revisions", headers=account["headers"])
    assert revisions.json()["items"][0]["change_kind"] == "delete"


async def test_a_stale_state_version_is_rejected(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, account["headers"], snapshot)
    striker, non_striker = ends(live)

    response = await api.post(
        f"/matches/{match_id}/deliveries",
        json={
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "expected_state_version": 0,
        },
        headers=account["headers"],
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "version_conflict"


async def test_a_completed_chase_finishes_the_match_and_names_the_winner(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    headers = account["headers"]
    snapshot = await create_match(api, headers, overs_limit=1)
    match_id = snapshot["match"]["id"]
    bowlers = squad_ids(snapshot, "b")

    live = await start_toss_and_innings(api, headers, snapshot)
    # One over, six singles: 6 all in the first innings.
    state = await bat_out_over(
        api, headers, match_id, bowler_id=bowlers[0], runs_per_ball=1, state=live
    )

    # The engine closes the innings on overs and opens the chase itself, so the
    # first innings has to be looked up by sequence rather than "current".
    assert len(state["innings"]) == 2
    first = next(i for i in state["innings"] if i["sequence"] == 1)
    assert first["state"]["total_runs"] == 6
    second = current_innings(state)
    assert second["sequence"] == 2
    assert second["target_runs"] == 7

    chase_bowler = squad_ids(snapshot, "a")[0]
    for _ in range(2):
        striker, non_striker = ends(state)
        result = await record(
            api,
            headers,
            match_id,
            {
                "striker_id": striker,
                "non_striker_id": non_striker,
                "bowler_id": chase_bowler,
                "batter_runs": 4,
                "is_boundary": True,
            },
        )
        state = result["state"]

    assert state["match"]["status"] == "completed"
    assert state["result"]["is_decided"] is True
    assert state["result"]["winner_team_id"] == snapshot["match"]["teams"]["b"]["id"]
    assert "wicket" in state["result"]["summary"]

    blocked = await api.post(
        f"/matches/{match_id}/deliveries",
        json={
            "striker_id": ends(state)[0],
            "non_striker_id": ends(state)[1],
            "bowler_id": chase_bowler,
        },
        headers=headers,
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "match_completed"


async def test_rebuilding_projections_reproduces_the_same_numbers(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    headers = account["headers"]
    snapshot = await create_match(api, headers)
    match_id = snapshot["match"]["id"]
    live = await start_toss_and_innings(api, headers, snapshot)
    state = await bat_out_over(
        api,
        headers,
        match_id,
        bowler_id=squad_ids(snapshot, "b")[0],
        runs_per_ball=2,
        balls=3,
        state=live,
    )
    before = current_innings(state)["state"]

    rebuilt = await api.post(f"/matches/{match_id}/rebuild", headers=headers)
    assert rebuilt.status_code == 200, rebuilt.text
    after = current_innings(rebuilt.json())["state"]

    assert before["total_runs"] == after["total_runs"]
    assert before["batting"] == after["batting"]
    assert before["bowling"] == after["bowling"]


# ---------------------------------------------------------------------- public


async def test_the_public_scorecard_needs_no_account(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    headers = account["headers"]
    snapshot = await create_match(api, headers)
    slug = snapshot["match"]["slug"]
    live = await start_toss_and_innings(api, headers, snapshot)
    striker, non_striker = ends(live)
    await record(
        api,
        headers,
        snapshot["match"]["id"],
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": squad_ids(snapshot, "b")[0],
            "batter_runs": 6,
        },
    )

    public = await api.get(f"/public/matches/{slug}")
    assert public.status_code == 200, public.text
    assert current_innings(public.json())["state"]["total_runs"] == 6
    assert public.headers["ETag"]
    assert "max-age" in public.headers["Cache-Control"]

    compact = await api.get(f"/public/matches/{slug}/state")
    assert compact.json()["score"]["runs"] == 6
    assert compact.json()["striker"]["runs"] == 6

    overlay = await api.get(f"/public/matches/{slug}/overlay")
    assert overlay.json()["score_text"] == "6/0"
    assert overlay.headers["Cache-Control"] == "no-store"


async def test_an_unchanged_scorecard_answers_304(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    slug = snapshot["match"]["slug"]

    first = await api.get(f"/public/matches/{slug}")
    etag = first.headers["ETag"]

    again = await api.get(f"/public/matches/{slug}", headers={"If-None-Match": etag})
    assert again.status_code == 304


async def test_a_deleted_match_disappears_from_the_public_link(
    api: AsyncClient, db: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import match_service

    invalidated: list[str] = []

    async def record_invalidation(slug: str) -> None:
        invalidated.append(slug)

    monkeypatch.setattr(match_service.state_cache, "invalidate_match", record_invalidation)

    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    slug = snapshot["match"]["slug"]

    # Read it first: in production this warms the Redis projection, and a warm
    # projection is exactly how a deleted match can keep being served.
    assert (await api.get(f"/public/matches/{slug}")).status_code == 200
    assert (await api.get(f"/public/matches/{slug}/exists")).status_code == 200

    deleted = await api.delete(f"/matches/{snapshot['match']['id']}", headers=account["headers"])
    assert deleted.status_code == 200, deleted.text

    assert invalidated == [slug], "deleting a match must drop its cached public payload"
    assert (await api.get(f"/public/matches/{slug}")).status_code == 404
    assert (await api.get(f"/public/matches/{slug}/exists")).status_code == 404


# ----------------------------------------------------------------- tournaments


async def test_a_tournament_generates_a_round_robin_and_a_points_table(
    api: AsyncClient, db: Any
) -> None:
    account = await register(api)
    headers = account["headers"]

    teams = []
    for name in ("Alpha", "Bravo", "Charlie"):
        created = await api.post(
            "/teams",
            json={"name": name, "players": [{"name": f"{name} {i}"} for i in range(1, 9)]},
            headers=headers,
        )
        assert created.status_code == 201, created.text
        teams.append(created.json())

    tournament = await api.post(
        "/tournaments",
        json={
            "name": "Sunday League",
            "tournament_format": "league",
            "default_overs_limit": 1,
            "team_ids": [t["id"] for t in teams],
        },
        headers=headers,
    )
    assert tournament.status_code == 201, tournament.text
    tournament_id = tournament.json()["id"]
    assert tournament.json()["team_count"] == 3

    fixtures = await api.post(
        f"/tournaments/{tournament_id}/fixtures/round-robin",
        json={"double_round": False},
        headers=headers,
    )
    assert fixtures.status_code == 201, fixtures.text
    # Three teams, single round: three fixtures.
    assert len(fixtures.json()) == 3

    standings = await api.get(f"/tournaments/{tournament_id}/standings", headers=headers)
    assert standings.status_code == 200, standings.text
    rows = standings.json()["standings"]
    assert len(rows) == 3
    assert all(row["played"] == 0 for row in rows)
    assert {row["team_name"] for row in rows} == {"Alpha", "Bravo", "Charlie"}

    public = await api.get(f"/public/tournaments/{tournament.json()['public_slug']}")
    assert public.status_code == 200, public.text
    assert len(public.json()["fixtures"]) == 3
    assert len(public.json()["standings"]) == 3


async def test_a_finished_fixture_moves_the_points_table(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    headers = account["headers"]

    tournament = (
        await api.post(
            "/tournaments",
            json={"name": "Cup", "default_overs_limit": 1},
            headers=headers,
        )
    ).json()

    snapshot = await create_match(api, headers, overs_limit=1, tournament_id=tournament["id"])
    match_id = snapshot["match"]["id"]

    participants = await api.post(
        f"/tournaments/{tournament['id']}/participants",
        json={
            "participants": [
                {"team_id": snapshot["match"]["teams"]["a"]["id"]},
                {"team_id": snapshot["match"]["teams"]["b"]["id"]},
            ]
        },
        headers=headers,
    )
    assert participants.status_code == 201, participants.text

    live = await start_toss_and_innings(api, headers, snapshot)
    state = await bat_out_over(
        api, headers, match_id, bowler_id=squad_ids(snapshot, "b")[0], runs_per_ball=1, state=live
    )
    # The chase manages a single run off the last ball and loses by five.
    chase_bowler = squad_ids(snapshot, "a")[0]
    state = await bat_out_over(
        api, headers, match_id, bowler_id=chase_bowler, runs_per_ball=0, balls=5, state=state
    )
    striker, non_striker = ends(state)
    final = await record(
        api,
        headers,
        match_id,
        {
            "striker_id": striker,
            "non_striker_id": non_striker,
            "bowler_id": chase_bowler,
            "batter_runs": 1,
        },
    )
    assert final["state"]["match"]["status"] == "completed"
    assert final["state"]["result"]["winner_team_id"] == snapshot["match"]["teams"]["a"]["id"]

    standings = await api.get(f"/tournaments/{tournament['id']}/standings", headers=headers)
    rows = {row["team_name"]: row for row in standings.json()["standings"]}
    assert rows["India"]["won"] == 1
    assert rows["India"]["points"] == 2
    assert rows["India"]["position"] == 1
    assert rows["Australia"]["lost"] == 1
    assert rows["India"]["net_run_rate"] > rows["Australia"]["net_run_rate"]


# ----------------------------------------------------------------------- tools


async def test_the_coin_flip_is_stamped_with_a_receipt(api: AsyncClient) -> None:
    response = await api.post("/tools/coin-flip", json={"call": "heads", "called_by": "Rohit"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"] in ("heads", "tails")
    assert body["call_correct"] is (body["result"] == "heads")
    assert len(body["receipt"]) == 32


async def test_the_wheel_returns_a_full_honest_ordering(api: AsyncClient) -> None:
    options = ["Alpha", "Bravo", "Charlie", "Delta"]
    response = await api.post("/tools/spin-wheel", json={"options": options, "picks": 2})
    assert response.status_code == 200, response.text
    body = response.json()
    assert sorted(body["order"]) == sorted(options)
    assert body["winners"] == body["order"][:2]


async def test_the_wheel_refuses_duplicate_options(api: AsyncClient) -> None:
    response = await api.post("/tools/spin-wheel", json={"options": ["A", "a"]})
    assert response.status_code == 422


# ---------------------------------------------------------------------- health


async def test_readiness_reports_the_database(api: AsyncClient, db: Any) -> None:
    response = await api.get("/health/ready")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["checks"]["database"]["ok"] is True
    # No Redis in the test environment: a cache outage is degraded, never unready.
    assert body["status"] in {"ok", "degraded"}
