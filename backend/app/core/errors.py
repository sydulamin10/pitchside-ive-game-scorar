"""Uniform error envelope.

Every failure — validation, domain rule, auth, or unexpected — leaves the API in
exactly one shape so clients need a single error path:

    {"error": {"code": "...", "message": "...", "details": {...},
               "request_id": "..."}}

Domain rule violations (illegal cricket actions) carry a stable machine code so
the scoring UI can react precisely instead of string-matching prose.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    """Base class for every error this application raises deliberately."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "bad_request"
    message: str = "The request could not be processed."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.details = details or {}
        self.status_code = status_code or self.status_code
        self.headers = headers or {}
        super().__init__(self.message)

    def to_payload(self, request_id: str | None = None) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        if request_id:
            error["request_id"] = request_id
        return {"error": error}


class BadRequest(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "bad_request"


class Unauthorized(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"
    message = "Authentication is required."

    def __init__(self, message: str | None = None, **kwargs: Any) -> None:
        kwargs.setdefault("headers", {"WWW-Authenticate": "Bearer"})
        super().__init__(message, **kwargs)


class Forbidden(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"
    message = "You do not have permission to perform this action."


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    message = "The requested resource does not exist."


class Conflict(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"
    message = "The request conflicts with the current state of the resource."


class VersionConflict(Conflict):
    code = "version_conflict"
    message = "This record changed since you loaded it. Reload the latest state and retry."


class UnprocessableEntity(AppError):
    status_code = 422
    code = "unprocessable_entity"


class RuleViolation(UnprocessableEntity):
    """A request that is well-formed but illegal under the laws of cricket."""

    code = "rule_violation"


class RateLimited(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"
    message = "Too many requests. Please slow down."


class ServiceUnavailable(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "service_unavailable"
    message = "A dependency is temporarily unavailable. Please retry."


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "unprocessable_entity",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def sqlstate_of(exc: BaseException) -> str | None:
    """Postgres SQLSTATE from a SQLAlchemy or DBAPI exception, if present."""
    orig = getattr(exc, "orig", None)
    for candidate in (orig, exc):
        for attr in ("sqlstate", "pgcode"):
            value = getattr(candidate, attr, None)
            if value:
                return str(value)
    return None


def app_error_for_db(exc: DBAPIError) -> AppError:
    """Map a driver error to the public envelope without leaking SQL."""
    sqlstate = sqlstate_of(exc)
    detail = str(getattr(exc, "orig", None) or exc).lower()

    if isinstance(exc, IntegrityError) or sqlstate in {"23505", "23503"}:
        if "uq_matches_public_slug" in detail:
            return Conflict(
                "Could not reserve a unique match link. Please try again.",
                code="slug_conflict",
            )
        if "uq_teams_owner_name" in detail:
            return Conflict("You already have a team with that name.", code="team_name_taken")
        if "uq_match_players_order" in detail:
            return Conflict(
                "Batting order numbers must be unique.", code="duplicate_batting_order"
            )
        return Conflict(
            "This could not be saved because it conflicts with existing data.",
            code="conflict",
        )
    if sqlstate == "23514":
        return UnprocessableEntity(
            "One of the values is not allowed for this match.",
            code="constraint_violation",
        )
    if sqlstate == "23502":
        return UnprocessableEntity("A required value was missing.", code="not_null_violation")
    if sqlstate in {"42703", "42P01"} or "undefined column" in detail or (
        "does not exist" in detail and ("column" in detail or "relation" in detail)
    ):
        return ServiceUnavailable(
            "The scoring database is being updated. Wait a few seconds and try again.",
            code="schema_outdated",
        )
    if isinstance(exc, OperationalError) or (sqlstate or "").startswith("08"):
        return ServiceUnavailable(
            "The database is waking up or unreachable. Please retry.",
            code="database_unavailable",
        )
    return AppError(
        "Something went wrong on our side. The incident was logged.",
        code="internal_error",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("app_error", code=exc.code, message=exc.message, exc_info=exc)
        else:
            logger.info("app_error", code=exc.code, message=exc.message, details=exc.details)
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.to_payload(_request_id(request)),
            headers=exc.headers or None,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "http_error")
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        payload: dict[str, Any] = {"error": {"code": code, "message": detail}}
        request_id = _request_id(request)
        if request_id:
            payload["error"]["request_id"] = request_id
        return JSONResponse(
            status_code=exc.status_code, content=payload, headers=exc.headers or None
        )

    @app.exception_handler(DBAPIError)
    async def _db_error(request: Request, exc: DBAPIError) -> JSONResponse:
        mapped = app_error_for_db(exc)
        if mapped.status_code >= 500:
            logger.error(
                "database_error",
                path=request.url.path,
                method=request.method,
                sqlstate=sqlstate_of(exc),
                exc_info=exc,
            )
        else:
            logger.warning(
                "database_error",
                path=request.url.path,
                method=request.method,
                code=mapped.code,
                sqlstate=sqlstate_of(exc),
            )
        return JSONResponse(
            status_code=mapped.status_code,
            content=mapped.to_payload(_request_id(request)),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {
                "field": ".".join(str(part) for part in err["loc"][1:]) or str(err["loc"][0]),
                "message": err["msg"],
                "type": err["type"],
            }
            for err in exc.errors()
        ]
        payload: dict[str, Any] = {
            "error": {
                "code": "validation_error",
                "message": "One or more fields are invalid.",
                "details": {"fields": fields},
            }
        }
        request_id = _request_id(request)
        if request_id:
            payload["error"]["request_id"] = request_id
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never leak internals: log the detail, return an opaque envelope.
        logger.error(
            "unhandled_exception",
            path=request.url.path,
            method=request.method,
            exc_info=exc,
        )
        payload: dict[str, Any] = {
            "error": {
                "code": "internal_error",
                "message": "Something went wrong on our side. The incident was logged.",
            }
        }
        request_id = _request_id(request)
        if request_id:
            payload["error"]["request_id"] = request_id
        return JSONResponse(status_code=500, content=payload)
