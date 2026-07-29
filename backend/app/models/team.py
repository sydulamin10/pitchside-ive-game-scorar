"""Saved teams and their rosters (reusable across matches and tournaments)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Index, SmallInteger, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import BattingHand, BowlingStyle, PlayerRole

if TYPE_CHECKING:
    from app.models.user import User


class Team(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "teams"
    __table_args__ = (
        Index(
            "uq_teams_owner_name_lower",
            "owner_user_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    owner_user_id: Mapped[uuid.UUID] = fk_uuid("users.id")
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(6), default=None)
    logo_url: Mapped[str | None] = mapped_column(String(512), default=None)
    primary_color: Mapped[str | None] = mapped_column(String(9), default=None)
    home_ground: Mapped[str | None] = mapped_column(String(120), default=None)

    owner: Mapped[User] = relationship(back_populates="teams")
    players: Mapped[list[Player]] = relationship(
        back_populates="team",
        cascade="all, delete-orphan",
        order_by="Player.sort_order",
        lazy="selectin",
    )

    @property
    def active_players(self) -> list[Player]:
        """Roster without retired entries, which are kept for old scorecards."""
        return [p for p in self.players if p.deleted_at is None]

    @property
    def display_short_name(self) -> str:
        if self.short_name:
            return self.short_name
        words = [w for w in self.name.split() if w]
        if len(words) >= 2:
            return "".join(w[0] for w in words[:3]).upper()
        return self.name[:3].upper()


class Player(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "players"
    __table_args__ = (Index("ix_players_team_active", "team_id", "deleted_at"),)

    team_id: Mapped[uuid.UUID] = fk_uuid("teams.id")
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    role: Mapped[PlayerRole] = mapped_column(
        enum_type(PlayerRole, "player_role"), nullable=False, default=PlayerRole.UNKNOWN
    )
    batting_hand: Mapped[BattingHand | None] = mapped_column(
        enum_type(BattingHand, "batting_hand"), default=None
    )
    bowling_style: Mapped[BowlingStyle | None] = mapped_column(
        enum_type(BowlingStyle, "bowling_style"), default=None
    )
    jersey_number: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    team: Mapped[Team] = relationship(back_populates="players")
