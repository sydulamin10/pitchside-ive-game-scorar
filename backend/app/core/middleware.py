"""Cross-cutting ASGI middleware.

Written as raw ASGI (rather than ``BaseHTTPMiddleware``) so that streaming
responses — the SSE score feed in particular — are never buffered and back
pressure is preserved.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.logging import bind_contextvars, clear_contextvars, get_logger

logger = get_logger("http")

REQUEST_ID_HEADER = "x-request-id"

#: Paths excluded from the access log to keep it signal-rich.
_QUIET_PATHS = frozenset({"/healthz", "/readyz", "/metrics", "/favicon.ico"})


class RequestContextMiddleware:
    """Assigns a request id, binds log context, and emits one access log line."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        incoming = headers.get(REQUEST_ID_HEADER, "")
        # Never echo an unvetted client value into logs/headers unchanged.
        request_id = incoming if _is_safe_request_id(incoming) else uuid.uuid4().hex

        state: MutableMapping[str, Any] = scope.setdefault("state", {})
        state["request_id"] = request_id
        state["client_ip"] = _client_ip(scope, headers)

        path = scope.get("path", "")
        method = scope.get("method", "")
        clear_contextvars()
        bind_contextvars(request_id=request_id, path=path, method=method)

        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            if path not in _QUIET_PATHS:
                log = logger.warning if status_code >= 500 else logger.info
                log(
                    "request",
                    status=status_code,
                    duration_ms=duration_ms,
                    ip=state["client_ip"],
                    user_agent=headers.get("user-agent", "")[:200],
                )
            clear_contextvars()


class SecurityHeadersMiddleware:
    """Hardens every response with conservative, framework-agnostic headers."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        # This API serves JSON only; a maximally strict CSP is therefore safe.
        # The one exception is the interactive docs, handled below.
        self.base_headers: list[tuple[str, str]] = [
            ("x-content-type-options", "nosniff"),
            ("x-frame-options", "DENY"),
            ("referrer-policy", "no-referrer"),
            ("cross-origin-opener-policy", "same-origin"),
            # The web app is on a different site (cPanel vs Render), so CORP
            # must be cross-origin. `same-site` makes Chrome hide the response
            # and report a CORS failure on POST /matches even when ACAO is set.
            ("cross-origin-resource-policy", "cross-origin"),
            ("permissions-policy", "camera=(self), microphone=(self), geolocation=()"),
            (
                "content-security-policy",
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            ),
        ]
        if settings.is_production:
            self.base_headers.append(
                ("strict-transport-security", "max-age=31536000; includeSubDomains; preload")
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        is_docs = path.rstrip("/") in ("/docs", "/redoc") or path == "/openapi.json"

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                for key, value in self.base_headers:
                    if is_docs and key == "content-security-policy":
                        # Swagger/ReDoc pull assets + inline styles from a CDN.
                        value = (
                            "default-src 'self'; "
                            "img-src 'self' data: https://fastapi.tiangolo.com; "
                            "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                            "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                            "font-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; "
                            "frame-ancestors 'none'; base-uri 'none'"
                        )
                    response_headers.setdefault(key, value)
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodySizeLimitMiddleware:
    """Rejects oversized payloads before they are buffered into memory."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    def _limit_for(self, path: str) -> int:
        # Local media PUTs carry the image body; allow the configured media ceiling.
        if "/media/local/" in path:
            return max(self.max_bytes, settings.MEDIA_MAX_BYTES)
        return self.max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return

        limit = self._limit_for(scope.get("path", ""))
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await _too_large(send, limit)
            return

        received = 0
        limit_exceeded = False

        async def receive_wrapper() -> Message:
            nonlocal received, limit_exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    limit_exceeded = True
                    # Signal end-of-stream; the guard below returns 413.
                    return {"type": "http.disconnect"}
            return message

        async def send_wrapper(message: Message) -> None:
            if limit_exceeded and message["type"] == "http.response.start":
                await _too_large(send, limit)
                return
            if limit_exceeded and message["type"] == "http.response.body":
                return
            await send(message)

        await self.app(scope, receive_wrapper, send_wrapper)


async def _too_large(send: Send, max_bytes: int) -> None:
    body = (
        b'{"error":{"code":"payload_too_large","message":"Request body exceeds the '
        + str(max_bytes).encode()
        + b' byte limit."}}'
    )
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


def _is_safe_request_id(value: str) -> bool:
    return bool(value) and len(value) <= 64 and all(c.isalnum() or c in "-_" for c in value)


def _client_ip(scope: Scope, headers: Headers) -> str:
    """Best-effort client IP.

    ``TRUSTED_PROXY`` semantics: we only trust ``x-forwarded-for`` because the
    process is expected to run behind exactly one reverse proxy (Render/Fly/
    Nginx) that overwrites it. Uvicorn's ``--proxy-headers`` handles the rest.
    """
    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    client = scope.get("client")
    return client[0] if client else "unknown"


MiddlewareFactory = Callable[[ASGIApp], Awaitable[None]]
