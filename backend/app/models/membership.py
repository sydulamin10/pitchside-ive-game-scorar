"""Team membership — roles beyond the legacy owner_user_id column."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import MembershipStatus, TeamMembershipRole

if TYPE_CHECKING:
    from app.models.team import Player, Team
    from app.models.user import User


class TeamMembership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "team_memberships"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_memberships_team_user"),
        UniqueConstraint("invite_token", name="uq_team_memberships_invite_token"),
        Index(
            "ix_team_memberships_user_active",
            "user_id",
            "status",
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_team_memberships_invited_email", "invited_email"),
    )

    team_id: Mapped[uuid.UUID] = fk_uuid("teams.id")
    user_id: Mapped[uuid.UUID | None] = fk_uuid("users.id", nullable=True, ondelete="CASCADE")
    player_id: Mapped[uuid.UUID | None] = fk_uuid(
        "players.id", nullable=True, ondelete="SET NULL", index=False
    )
    role: Mapped[TeamMembershipRole] = mapped_column(
        enum_type(TeamMembershipRole, "team_membership_role"),
        nullable=False,
        default=TeamMembershipRole.PLAYER,
    )
    status: Mapped[MembershipStatus] = mapped_column(
        enum_type(MembershipStatus, "membership_status"),
        nullable=False,
        default=MembershipStatus.ACTIVE,
    )
    invited_email: Mapped[str | None] = mapped_column(String(320), default=None)
    invite_token: Mapped[str | None] = mapped_column(String(64), default=None)
    invited_by_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        "users.id", nullable=True, ondelete="SET NULL", index=False
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    team: Mapped[Team] = relationship(back_populates="memberships")
    user: Mapped[User | None] = relationship(foreign_keys=[user_id])
    player: Mapped[Player | None] = relationship()
    invited_by: Mapped[User | None] = relationship(foreign_keys=[invited_by_user_id])
