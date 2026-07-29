"""Realtime event envelopes.

Every frame carries ``state_version`` so a client can tell whether it missed
something: versions are strictly increasing per match, so a gap means "refetch".
Frames stay small — a compact live summary rather than the whole scorecard —
because the pitch-side scorer and most viewers are on mobile data.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class EventType(StrEnum):
    SCORE_UPDATE = "score.update"
    MATCH_UPDATED = "match.updated"
    INNINGS_CHANGED = "innings.changed"
    MATCH_COMPLETED = "match.completed"
    STANDINGS_UPDATED = "standings.updated"
    RESYNC = "resync"


def envelope(
    event_type: EventType, *, match_id: str, state_version: int, data: dict[str, Any]
) -> dict[str, Any]:
    return {
        "type": event_type.value,
        "match_id": match_id,
        "state_version": state_version,
        "emitted_at": datetime.now(UTC).isoformat(),
        "data": data,
    }
