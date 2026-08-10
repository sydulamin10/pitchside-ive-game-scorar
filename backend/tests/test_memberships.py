"""Team membership invites and join requests (requires TEST_DATABASE_URL)."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import requires_db
from tests.test_api_flows import register

pytestmark = [requires_db, pytest.mark.integration]


async def test_membership_invite_accept_and_join_request(api: AsyncClient, db: Any) -> None:
    owner = await register(api)
    guest = await register(api, display_name="Guest Scorer")
    requester = await register(api, display_name="Requester")

    team_resp = await api.post(
        "/teams",
        headers=owner["headers"],
        json={"name": "Invite FC", "short_name": "IFC", "players": []},
    )
    assert team_resp.status_code == 201, team_resp.text
    team_id = team_resp.json()["id"]

    members = await api.get(f"/teams/{team_id}/members", headers=owner["headers"])
    assert members.status_code == 200
    assert any(m["role"] == "owner" and m["status"] == "active" for m in members.json())

    invite = await api.post(
        f"/teams/{team_id}/invites",
        headers=owner["headers"],
        json={"email": guest["email"], "role": "manager"},
    )
    assert invite.status_code == 201, invite.text
    assert invite.json()["status"] == "invited"
    token = invite.json()["invite_token"]
    assert token

    accept = await api.post(f"/teams/invites/{token}/accept", headers=guest["headers"])
    assert accept.status_code == 200, accept.text
    assert accept.json()["status"] == "active"
    assert accept.json()["role"] == "manager"

    # Manager can see the team.
    peek = await api.get(f"/teams/{team_id}", headers=guest["headers"])
    assert peek.status_code == 200

    join = await api.post(
        f"/teams/{team_id}/join-requests",
        headers=requester["headers"],
    )
    assert join.status_code == 201, join.text
    member_id = join.json()["id"]
    assert join.json()["status"] == "requested"

    accepted = await api.post(
        f"/teams/{team_id}/join-requests/{member_id}/accept",
        headers=owner["headers"],
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "active"

    role = await api.patch(
        f"/teams/{team_id}/members/{member_id}",
        headers=owner["headers"],
        json={"role": "player"},
    )
    assert role.status_code == 200
    assert role.json()["role"] == "player"

    removed = await api.delete(
        f"/teams/{team_id}/members/{member_id}",
        headers=owner["headers"],
    )
    assert removed.status_code == 200
