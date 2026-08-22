"""Boot-time migrations must survive a sleeping Neon, then stop retrying."""

from __future__ import annotations

from sqlalchemy.exc import OperationalError

from app.db import migrate


class _Orig(Exception):
    def __init__(self) -> None:
        super().__init__("connection refused")


def test_upgrade_retries_a_cold_database_then_succeeds(monkeypatch) -> None:
    calls = {"n": 0}

    def fake_upgrade(_config: object, revision: str) -> None:
        assert revision == "head"
        calls["n"] += 1
        if calls["n"] < 3:
            raise OperationalError("upgrade", {}, _Orig())

    monkeypatch.setattr(migrate.command, "upgrade", fake_upgrade)
    monkeypatch.setattr(migrate.time, "sleep", lambda _seconds: None)
    migrate.upgrade_to_head()
    assert calls["n"] == 3
