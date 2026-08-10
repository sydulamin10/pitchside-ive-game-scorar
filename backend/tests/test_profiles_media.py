"""Profile + media API flows (requires TEST_DATABASE_URL)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import requires_db
from tests.test_api_flows import register

pytestmark = [requires_db, pytest.mark.integration]


async def test_team_and_player_public_profiles_and_media_upload(
    api: AsyncClient, db: Any, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "MEDIA_BACKEND", "local")
    monkeypatch.setattr(settings, "MEDIA_LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "http://testserver")
    monkeypatch.setattr(settings, "PUBLIC_WEB_URL", "http://localhost:5173")

    owner = await register(api)

    created = await api.post(
        "/teams",
        json={
            "name": "Mumbai Strikers",
            "short_name": "MUM",
            "primary_color": "#1e3a2d",
            "secondary_color": "#e2a73b",
            "home_ground": "Wankhede nets",
            "founded_year": 2012,
            "description": "Neighbourhood XI.",
            "coach_name": "Rahul",
            "players": [{"name": "Ali", "role": "batter", "jersey_number": 7}],
        },
        headers=owner["headers"],
    )
    assert created.status_code == 201, created.text
    team = created.json()
    assert team["public_slug"]
    assert team["profile_url"].endswith(f"/club/{team['public_slug']}")
    assert team["players"][0]["public_slug"]
    assert team["players"][0]["profile_url"]

    # Mint upload URL and PUT a tiny PNG.
    signed = await api.post(
        "/media/upload-url",
        json={
            "kind": "team_logo",
            "content_type": "image/png",
            "filename": "logo.png",
            "content_length": 8,
        },
        headers=owner["headers"],
    )
    assert signed.status_code == 200, signed.text
    body = signed.json()
    token = body["upload_url"].rsplit("/", 1)[-1]
    put = await api.put(
        f"/media/local/{token}",
        content=b"\x89PNG\r\n\x1a\n",
        headers={**owner["headers"], "Content-Type": "image/png"},
    )
    assert put.status_code == 204, put.text

    patched = await api.patch(
        f"/teams/{team['id']}",
        json={"logo_url": body["public_url"], "cover_url": body["public_url"]},
        headers=owner["headers"],
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["logo_url"] == body["public_url"]

    player_id = team["players"][0]["id"]
    player_patch = await api.patch(
        f"/teams/{team['id']}/players/{player_id}",
        json={
            "photo_url": body["public_url"],
            "nickname": "Ace",
            "bio": "Opens the batting.",
            "jersey_number": 7,
        },
        headers=owner["headers"],
    )
    assert player_patch.status_code == 200, player_patch.text
    assert player_patch.json()["nickname"] == "Ace"

    public_team = await api.get(f"/public/teams/{team['public_slug']}")
    assert public_team.status_code == 200, public_team.text
    assert public_team.json()["name"] == "Mumbai Strikers"
    assert public_team.json()["logo_url"] == body["public_url"]
    assert len(public_team.json()["players"]) == 1

    player_slug = player_patch.json()["public_slug"]
    public_player = await api.get(f"/public/players/{player_slug}")
    assert public_player.status_code == 200, public_player.text
    assert public_player.json()["nickname"] == "Ace"
    assert public_player.json()["team"]["name"] == "Mumbai Strikers"

    # UUID lookup also works for public profiles.
    by_id = await api.get(f"/public/teams/{team['id']}")
    assert by_id.status_code == 200
    assert by_id.json()["public_slug"] == team["public_slug"]

    stranger = await register(api, display_name="Stranger")
    peek = await api.get(f"/teams/{team['id']}", headers=stranger["headers"])
    assert peek.status_code == 403
