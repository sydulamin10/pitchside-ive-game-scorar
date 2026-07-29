"""Liveness and readiness probes."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Response
from sqlalchemy import text

from app.api.deps import SessionDep
from app.core.config import settings
from app.db.redis import redis_healthy
from app.realtime.broker import broker

router = APIRouter(tags=["health"])

_STARTED_AT = time.time()


@router.get("/health", summary="Liveness", response_model=None)
async def health() -> dict[str, Any]:
    """Cheap check: is the process up? Never touches a dependency."""
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME,
        "environment": settings.ENV,
        "uptime_seconds": round(time.time() - _STARTED_AT, 1),
    }


@router.get("/health/ready", summary="Readiness", response_model=None)
async def ready(response: Response, session: SessionDep) -> dict[str, Any]:
    """Deep check used by the load balancer before sending traffic."""
    database_ok = True
    started = time.perf_counter()
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - any failure means "not ready"
        database_ok = False
    db_latency_ms = round((time.perf_counter() - started) * 1000, 2)

    cache_ok = await redis_healthy()
    # Redis is a performance layer, so a cache outage is degraded, not unready.
    if not database_ok:
        response.status_code = 503

    return {
        "status": "ok" if database_ok and cache_ok else ("degraded" if database_ok else "error"),
        "checks": {
            "database": {"ok": database_ok, "latency_ms": db_latency_ms},
            "cache": {"ok": cache_ok, "configured": settings.REDIS_URL is not None},
        },
        "realtime": {"subscribers": broker.subscriber_count},
        "version": settings.PROJECT_NAME,
    }
