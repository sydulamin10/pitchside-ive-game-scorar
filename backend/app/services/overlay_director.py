"""Live overlay director: what the camera / OBS overlay should show right now.

Scorers and admins push a small JSON blob (which panel is on air, the ticker
text, overlay design, corner branding, sponsor). Camera phones and overlays
subscribe through the existing compact SSE frame — no second channel.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.realtime.broker import broker, channel_for_match
from app.realtime.events import EventType, envelope
from app.services import state_cache
from app.services.match_query import load_snapshot

PANELS = frozenset({"live", "scorecard", "innings1", "innings2", "squad", "over", "sponsor", "hidden"})
BRAND_MODES = frozenset({"none", "name", "logo"})
DESIGNS = frozenset(
    {
        "classic",
        "circle",
        "split",
        "arena",
        "emerald",
        "chase",
        "modern",
        "premium",
        "dark",
        "clean",
        "tournament",
        "minimal",
    }
)
_KIND = "overlay"
_TTL_SECONDS = 7 * 24 * 3600
_memory: dict[str, dict[str, Any]] = {}

DEFAULT: dict[str, Any] = {
    "panel": "hidden",
    "ticker": "",
    "ticker_on": False,
    "show_tournament": True,
    "design": "circle",
    "brand_mode": "name",
    "brand_name": "",
    "brand_logo_url": "",
    "sponsor_logo_url": "",
    "sponsor_on": False,
}


def _clip(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _normalise(payload: dict[str, Any] | None) -> dict[str, Any]:
    raw = payload or {}
    merged = {**DEFAULT, **raw}
    panel = merged.get("panel")
    merged["panel"] = panel if panel in PANELS else "hidden"
    merged["ticker"] = _clip(merged.get("ticker"), 400)
    merged["ticker_on"] = bool(merged.get("ticker_on"))
    design = merged.get("design")
    merged["design"] = design if design in DESIGNS else "circle"
    mode = raw.get("brand_mode")
    if mode not in BRAND_MODES:
        show = raw["show_tournament"] if "show_tournament" in raw else merged.get("show_tournament", True)
        mode = "none" if not show else "name"
    merged["brand_mode"] = mode
    merged["show_tournament"] = mode != "none"
    merged["brand_name"] = _clip(merged.get("brand_name"), 80)
    merged["brand_logo_url"] = _clip(merged.get("brand_logo_url"), 500)
    merged["sponsor_logo_url"] = _clip(merged.get("sponsor_logo_url"), 500)
    merged["sponsor_on"] = bool(merged.get("sponsor_on"))
    return merged


async def get(match_id: str) -> dict[str, Any]:
    cached = await state_cache.get_json(_KIND, match_id)
    if cached is not None:
        return _normalise(cached)
    return _normalise(_memory.get(match_id))


async def put(match_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    current = await get(match_id)
    allowed = {k: v for k, v in patch.items() if k in DEFAULT and v is not None}
    if "brand_mode" not in allowed and "show_tournament" in allowed:
        allowed["brand_mode"] = "name" if allowed["show_tournament"] else "none"
    merged = _normalise({**current, **allowed})
    _memory[match_id] = merged
    await state_cache.set_json(_KIND, match_id, merged, ttl_seconds=_TTL_SECONDS)
    return merged


def attach(compact: dict[str, Any], graphics: dict[str, Any]) -> dict[str, Any]:
    compact["graphics"] = graphics
    return compact


async def attach_for(match_id: str | uuid.UUID, compact: dict[str, Any]) -> dict[str, Any]:
    return attach(compact, await get(str(match_id)))


async def publish(
    session: AsyncSession,
    match: Match,
    patch: dict[str, Any],
) -> dict[str, Any]:
    """Persist director state and push it on the live score stream."""
    graphics = await put(str(match.id), patch)
    compact = await state_cache.get_compact(match.public_slug)
    if compact is None:
        snapshot = await load_snapshot(session, match_id=match.id)
        compact = snapshot.compact()
    compact = await attach_for(match.id, compact)
    await state_cache.put_compact(match.public_slug, compact)
    await broker.publish(
        channel_for_match(str(match.id)),
        envelope(
            EventType.SCORE_UPDATE,
            match_id=str(match.id),
            state_version=match.state_version,
            data=compact,
        ),
    )
    return graphics
