"""Live broadcast / camera stream sessions for a match."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import StreamSessionStatus

if TYPE_CHECKING:
    from app.models.match import Match
    from app.models.user import User


class StreamSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "stream_sessions"
    __table_args__ = (
        Index("ix_stream_sessions_match_status", "match_id", "status"),
        Index("ix_stream_sessions_status", "status"),
        Index(
            "uq_stream_sessions_camera_token",
            "camera_token",
            unique=True,
            postgresql_where=text("camera_token IS NOT NULL"),
        ),
    )

    match_id: Mapped[uuid.UUID] = fk_uuid("matches.id")
    created_by_user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    status: Mapped[StreamSessionStatus] = mapped_column(
        enum_type(StreamSessionStatus, "stream_session_status"),
        nullable=False,
        default=StreamSessionStatus.IDLE,
    )
    destination_label: Mapped[str | None] = mapped_column(String(120), default=None)
    rtmp_url: Mapped[str | None] = mapped_column(String(512), default=None)
    #: Fernet ciphertext of the stream key; never returned after create/update.
    stream_key_encrypted: Mapped[str | None] = mapped_column(Text, default=None)
    whip_path: Mapped[str | None] = mapped_column(String(160), default=None)
    #: Unauthenticated cameraman invite; minted on create.
    camera_token: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), default=None, unique=False
    )
    publisher_claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    last_error: Mapped[str | None] = mapped_column(Text, default=None)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    match: Mapped[Match] = relationship(back_populates="stream_sessions")
    creator: Mapped[User] = relationship()

