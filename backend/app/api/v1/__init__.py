"""Version 1 of the HTTP API."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    auth,
    billing,
    health,
    matches,
    media,
    public,
    scoring,
    stream,
    teams,
    tools,
    tournaments,
    users,
)

api_router = APIRouter()

# Ordering matters only for readability; every router carries its own prefix.
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(admin.router)
api_router.include_router(billing.router)
api_router.include_router(teams.router)
api_router.include_router(media.router)
api_router.include_router(matches.router)
api_router.include_router(scoring.router)
api_router.include_router(tournaments.router)
api_router.include_router(public.router)
api_router.include_router(stream.router)
api_router.include_router(tools.router)

__all__ = ["api_router"]
