"""Audit trail writes.

Auditing is best-effort by design: a failure to record an audit row must never
break the user's action, but it is logged loudly so it cannot go unnoticed.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.audit import AuditLog
from app.models.enums import AuditAction

logger = get_logger(__name__)


async def record(
    session: AsyncSession,
    action: AuditAction,
    *,
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    context: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """Append an audit entry to the current transaction."""
    try:
        entry = AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            context=context or {},
        )
        if request is not None:
            entry.ip_address = getattr(request.state, "client_ip", None)
            entry.user_agent = request.headers.get("user-agent", "")[:256] or None
            entry.request_id = getattr(request.state, "request_id", None)
        session.add(entry)
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("audit_write_failed", action=action.value, error=str(exc))
