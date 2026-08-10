"""Stream sessions API (requires TEST_DATABASE_URL)."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import requires_db
from tests.test_api_flows import create_match, register

pytestmark = [requires_db, pytest.mark.integration]


async def test_stream_session_create_go_live_end(api: AsyncClient, db: Any) -> None:
    account = await register(api)
    snapshot = await create_match(api, account["headers"])
    match_id = snapshot["match"]["id"]

    created = await api.post(
        f"/matches/{match_id}/stream-sessions",
        headers=account["headers"],
        json={
            "destination_label": "YouTube",
            "rtmp_url": "rtmp://a.rtmp.youtube.com/live2",
            "stream_key": "secret-key-value",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "idle"
    assert body["stream_key"] == "secret-key-value"
    assert body["whip_publish_url"]
    assert body["has_stream_key"] is True

    active = await api.get(
        f"/matches/{match_id}/stream-sessions/active",
        headers=account["headers"],
    )
    assert active.status_code == 200, active.text
    assert "stream_key" not in active.json()
    assert active.json()["has_stream_key"] is True

    live = await api.post(
        f"/matches/{match_id}/stream-sessions/active/go-live",
        headers=account["headers"],
    )
    assert live.status_code == 200, live.text
    assert live.json()["status"] == "live"
    assert "stream_key" not in live.json()

    ended = await api.post(
        f"/matches/{match_id}/stream-sessions/active/end",
        headers=account["headers"],
    )
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "ended"
