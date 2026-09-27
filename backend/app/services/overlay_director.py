"""Live overlay director: what the camera / OBS overlay should show right now.

Scorers and admins push a small JSON blob (which panel is on air, the ticker
text, overlay design, corner branding, sponsor). Camera phones and overlays
subscribe through the existing compact SSE frame — no second channel.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.realtime.broker import broker, channel_for_match
from app.realtime.events import EventType, envelope
from app.services import state_cache
from app.services.match_query import load_snapshot

PANELS = frozenset(
    {
        "live",
        "scorecard",
        "innings1",
        "innings2",
        "squad",
        "over",
        "sponsor",
        "summary",
        "worm",
        "runrate",
        "hidden",
        "clean",
    }
)
BRAND_MODES = frozenset({"none", "name", "logo"})
SCOREBAR_POS = frozenset({"top", "center", "bottom"})
LOGO_POS = frozenset({"top-left", "top-right", "bottom-left", "bottom-right"})
SPONSOR_POS = frozenset({"top-right", "top-left", "center", "bottom", "fullscreen"})
DECK_POS = frozenset({"top", "center", "bottom"})
SPONSOR_LAYOUTS = frozenset({"corner", "grid", "fullscreen"})
MAX_SPONSORS = 6
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
        "icc",
        "stat",
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
    "design": "icc",
    "brand_mode": "name",
    "brand_name": "",
    "brand_logo_url": "",
    "sponsor_logo_url": "",
    "sponsor_on": False,
    "sponsors": [],
    "sponsor_layout": "corner",
    "scorebar_on": True,
    "logo_on": True,
    "player_card_on": True,
    "anim_four": True,
    "anim_six": True,
    "anim_wicket": True,
    "anim_extras": True,
    "anim_cue": "",
    "clean": False,
    "scorebar_pos": "bottom",
    "logo_pos": "top-left",
    "sponsor_pos": "top-right",
    "deck_pos": "top",
    "summary_until": "",
}


def _clip(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _normalise_sponsors(raw: dict[str, Any]) -> list[dict[str, Any]]:
    items = raw.get("sponsors")
    out: list[dict[str, Any]] = []
    if isinstance(items, list):
        for i, item in enumerate(items[:MAX_SPONSORS]):
            if isinstance(item, str):
                url = _clip(item, 500)
                if url:
                    out.append({"id": f"s{i}", "url": url, "on": True})
                continue
            if not isinstance(item, dict):
                continue
            url = _clip(item.get("url") or item.get("logo_url"), 500)
            if not url:
                continue
            sid = _clip(item.get("id"), 40) or f"s{i}"
            on = True if item.get("on") is None else bool(item.get("on"))
            out.append({"id": sid, "url": url, "on": on})
    if out:
        return out
    legacy = _clip(raw.get("sponsor_logo_url"), 500)
    if legacy:
        return [{"id": "legacy", "url": legacy, "on": True}]
    return []


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
    sponsors = _normalise_sponsors(merged)
    merged["sponsors"] = sponsors
    first_on = next((item for item in sponsors if item["on"]), sponsors[0] if sponsors else None)
    merged["sponsor_logo_url"] = first_on["url"] if first_on else _clip(merged.get("sponsor_logo_url"), 500)
    merged["sponsor_on"] = bool(merged.get("sponsor_on"))
    layout = merged.get("sponsor_layout")
    merged["sponsor_layout"] = layout if layout in SPONSOR_LAYOUTS else "corner"
    for flag in (
        "scorebar_on",
        "logo_on",
        "player_card_on",
        "anim_four",
        "anim_six",
        "anim_wicket",
        "anim_extras",
        "clean",
    ):
        if flag not in raw and flag in DEFAULT:
            merged[flag] = bool(merged.get(flag, DEFAULT[flag]))
        else:
            merged[flag] = bool(merged.get(flag))
    if merged["panel"] == "clean":
        merged["clean"] = True
    merged["anim_cue"] = _clip(merged.get("anim_cue"), 64)
    pos = merged.get("scorebar_pos")
    merged["scorebar_pos"] = pos if pos in SCOREBAR_POS else "bottom"
    logo_pos = merged.get("logo_pos")
    merged["logo_pos"] = logo_pos if logo_pos in LOGO_POS else "top-left"
    sponsor_pos = merged.get("sponsor_pos")
    merged["sponsor_pos"] = sponsor_pos if sponsor_pos in SPONSOR_POS else "top-right"
    deck_pos = merged.get("deck_pos")
    merged["deck_pos"] = deck_pos if deck_pos in DECK_POS else "top"
    until = _clip(merged.get("summary_until"), 64)
    merged["summary_until"] = until
    if merged["panel"] == "summary" and until:
        try:
            expiry = datetime.fromisoformat(until)
        except ValueError:
            expiry = None
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=UTC)
        if expiry is not None and expiry <= datetime.now(UTC):
            merged["panel"] = "hidden"
            merged["summary_until"] = ""
    return merged


async def get(match_id: str) -> dict[str, Any]:
    cached = await state_cache.get_json(_KIND, match_id)
    if cached is not None:
        return _normalise(cached)
    return _normalise(_memory.get(match_id))


async def put(match_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    current = await get(match_id)
    allowed = {k: v for k, v in patch.items() if k in DEFAULT and v is not None}
    if allowed.get("panel") and allowed["panel"] != "summary":
        allowed["summary_until"] = ""
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
