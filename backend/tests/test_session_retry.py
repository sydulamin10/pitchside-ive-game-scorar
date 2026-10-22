"""A sleeping Neon must be retried, not surfaced as a failed login."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError, OperationalError

from app.db.session import is_transient_db_error, open_session


class _Orig(Exception):
    def __init__(self, sqlstate: str, message: str) -> None:
        super().__init__(message)
        self.sqlstate = sqlstate


def test_connection_failures_are_transient() -> None:
    exc = OperationalError("SELECT 1", {}, _Orig("08006", "connection failed"))
    assert is_transient_db_error(exc)


def test_neon_sleep_copy_is_transient() -> None:
    exc = OperationalError(
        "SELECT 1",
        {},
        Exception("Couldn't connect: compute is not active"),
    )
    assert is_transient_db_error(exc)


def test_integrity_errors_are_not_retried() -> None:
    exc = IntegrityError("INSERT", {}, _Orig("23505", "duplicate key"))
    assert not is_transient_db_error(exc)


async def test_open_session_retries_then_succeeds(monkeypatch) -> None:
    calls = {"n": 0}

    class FakeSession:
        async def connection(self) -> None:
            calls["n"] += 1
            if calls["n"] < 3:
                raise OperationalError("connect", {}, _Orig("08006", "connection refused"))

        async def close(self) -> None:
            return None

    async def _no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("app.db.session.SessionFactory", lambda: FakeSession())
    monkeypatch.setattr("app.db.session.asyncio.sleep", _no_sleep)
    session = await open_session()
    assert calls["n"] == 3
    assert isinstance(session, FakeSession)
