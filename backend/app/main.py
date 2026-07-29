"""Application factory and process lifecycle.

Start-up order matters: logging first (so everything after it is observable),
then Redis (optional), then the realtime broker, and only then does the app begin
accepting traffic. Shutdown is the exact reverse, and always runs.
"""

from __future__ import annotations

import asyncio
import contextlib
import sys
import warnings
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.v1 import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import (
    BodySizeLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.db.redis import close_redis, init_redis
from app.db.session import dispose_engine
from app.realtime.broker import broker

logger = get_logger(__name__)

if sys.platform == "win32":  # pragma: no cover - Windows development only
    # psycopg's async driver refuses to run on Windows' default proactor loop.
    # Deployments are Linux, so this only matters for local development. Note that
    # a server may pick the loop itself and ignore this policy — see the check in
    # `lifespan`, and `python -m app`, which asks uvicorn to respect it.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _require_compatible_event_loop() -> None:
    """Fail at start-up rather than on every query.

    On Windows, uvicorn hard-codes the proactor loop unless it is reloading in a
    subprocess, and psycopg cannot use it. Left alone, that surfaces as a 500 on
    the first request that touches the database, which is a confusing way to learn
    about an event loop. So refuse to start, and say what to run instead.
    """
    if sys.platform != "win32":  # pragma: no cover - Windows development only
        return
    loop = asyncio.get_running_loop()
    if isinstance(loop, asyncio.ProactorEventLoop):
        raise RuntimeError(
            "This process is running on Windows' proactor event loop, which the "
            "async Postgres driver cannot use. Start the API with `python -m app` "
            "(or add --reload to uvicorn) so it runs on a selector loop."
        )


DESCRIPTION = """
Live cricket scoring: ball-by-ball recording, derived scorecards, tournaments,
and a realtime public feed.

**Design rule that governs the whole API**: the ball-by-ball delivery log is the
only source of truth. Every score, average, economy rate, points-table row and
match result is derived by replaying that log, so correcting a mistake from an
hour ago silently fixes every number that depended on it.
"""


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    _require_compatible_event_loop()
    logger.info(
        "startup",
        environment=settings.ENV,
        cache_configured=settings.REDIS_URL is not None,
    )
    await init_redis()
    await broker.start()
    try:
        yield
    finally:
        await broker.stop()
        await close_redis()
        await dispose_engine()
        logger.info("shutdown_complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        description=DESCRIPTION,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.OPENAPI_ENABLED else None,
        redoc_url="/redoc" if settings.OPENAPI_ENABLED else None,
        openapi_url="/openapi.json" if settings.OPENAPI_ENABLED else None,
        servers=[{"url": settings.PUBLIC_API_URL, "description": settings.ENV}],
        contact={"name": settings.PROJECT_NAME},
        swagger_ui_parameters={"persistAuthorization": True},
    )

    # Middleware runs bottom-up on the way in: the outermost entry here is the
    # last one added, so request context wraps everything and is always logged.
    app.add_middleware(GZipMiddleware, minimum_size=1_024, compresslevel=5)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.MAX_REQUEST_BODY_BYTES)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id", "If-None-Match"],
        expose_headers=[
            "X-Request-Id",
            "ETag",
            "RateLimit-Limit",
            "RateLimit-Remaining",
            "RateLimit-Reset",
            "Retry-After",
        ],
        max_age=600,
    )
    if settings.ALLOWED_HOSTS and settings.ALLOWED_HOSTS != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)
    app.add_middleware(RequestContextMiddleware)
    if settings.METRICS_ENABLED:
        _mount_metrics(app)

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    # Unversioned aliases, because orchestrators and uptime checks expect them at
    # a fixed path that never moves with the API version.
    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, Any]:
        return {
            "service": settings.PROJECT_NAME,
            "api": settings.API_V1_PREFIX,
            "docs": "/docs" if settings.OPENAPI_ENABLED else None,
            "status": "ok",
        }

    @app.get("/robots.txt", include_in_schema=False, response_class=PlainTextResponse)
    async def robots() -> str:
        # The API has nothing worth crawling; the web app handles SEO.
        return "User-agent: *\nDisallow: /\n"

    return app


def _mount_metrics(app: FastAPI) -> None:
    from app.core.metrics import MetricsMiddleware, render_latest

    app.add_middleware(MetricsMiddleware)

    @app.get("/metrics", include_in_schema=False, response_class=PlainTextResponse)
    async def metrics() -> PlainTextResponse:
        body, content_type = render_latest()
        return PlainTextResponse(body, media_type=content_type)


app = create_app()
