"""Database errors must become a stable API envelope, not an opaque 500."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from app.core.errors import app_error_for_db, sqlstate_of


class _Orig(Exception):
    def __init__(self, sqlstate: str, message: str) -> None:
        super().__init__(message)
        self.sqlstate = sqlstate


def test_sqlstate_is_read_from_the_driver_error() -> None:
    exc = IntegrityError("INSERT", {}, _Orig("23505", "duplicate key"))
    assert sqlstate_of(exc) == "23505"


def test_a_missing_innings_column_is_a_schema_outage() -> None:
    exc = ProgrammingError(
        "SELECT",
        {},
        _Orig("42703", 'column innings.crease_after_sequence does not exist'),
    )
    mapped = app_error_for_db(exc)
    assert mapped.status_code == 503
    assert mapped.code == "schema_outdated"


def test_a_slug_collision_asks_the_client_to_retry() -> None:
    exc = IntegrityError(
        "INSERT",
        {},
        _Orig("23505", 'duplicate key value violates unique constraint "uq_matches_public_slug"'),
    )
    mapped = app_error_for_db(exc)
    assert mapped.status_code == 409
    assert mapped.code == "slug_conflict"


def test_a_database_blip_is_retryable() -> None:
    exc = OperationalError("SELECT 1", {}, _Orig("08006", "connection failed"))
    mapped = app_error_for_db(exc)
    assert mapped.status_code == 503
    assert mapped.code == "database_unavailable"
