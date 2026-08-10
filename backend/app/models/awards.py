"""Player awards (trophies, certificates, achievements) attached to a roster player."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import AwardKind

if TYPE_CHECKING:
    from app.models.team import Player, Team
    from app.models.user import User


class PlayerAward(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "player_awards"
    __table_args__ = (Index("ix_player_awards_player", "player_id", "awarded_at"),)

    player_id: Mapped[uuid.UUID] = fk_uuid("players.id")
    team_id: Mapped[uuid.UUID | None] = fk_uuid(
        "teams.id", nullable=True, ondelete="SET NULL", index=False
    )
    kind: Mapped[AwardKind] = mapped_column(
        enum_type(AwardKind, "award_kind"), nullable=False, default=AwardKind.ACHIEVEMENT
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(512), default=None)
    created_by_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        "users.id", nullable=True, ondelete="SET NULL", index=False
    )

    player: Mapped[Player] = relationship(back_populates="awards")
    team: Mapped[Team | None] = relationship()
    created_by: Mapped[User | None] = relationship()
