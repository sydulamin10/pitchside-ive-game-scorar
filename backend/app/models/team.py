"""Saved teams and their rosters (reusable across matches and tournaments)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, Date, Float, Index, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import BattingHand, BowlingStyle, PlayerRole

if TYPE_CHECKING:
    from app.models.awards import PlayerAward
    from app.models.membership import TeamMembership
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
        Index(
            "uq_teams_public_slug",
            "public_slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND public_slug IS NOT NULL"),
        ),
    )

    owner_user_id: Mapped[uuid.UUID] = fk_uuid("users.id")
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(6), default=None)
    public_slug: Mapped[str | None] = mapped_column(String(120), default=None)
    logo_url: Mapped[str | None] = mapped_column(String(512), default=None)
    cover_url: Mapped[str | None] = mapped_column(String(512), default=None)
    primary_color: Mapped[str | None] = mapped_column(String(9), default=None)
    secondary_color: Mapped[str | None] = mapped_column(String(9), default=None)
    home_ground: Mapped[str | None] = mapped_column(String(120), default=None)
    founded_year: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    coach_name: Mapped[str | None] = mapped_column(String(80), default=None)
    manager_name: Mapped[str | None] = mapped_column(String(80), default=None)
    owner_label: Mapped[str | None] = mapped_column(String(80), default=None)
    sponsor: Mapped[str | None] = mapped_column(String(120), default=None)
    contact_email: Mapped[str | None] = mapped_column(String(254), default=None)
    contact_phone: Mapped[str | None] = mapped_column(String(40), default=None)
    social_links: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    owner: Mapped[User] = relationship(back_populates="teams")
    players: Mapped[list[Player]] = relationship(
        back_populates="team",
        cascade="all, delete-orphan",
        order_by="Player.sort_order",
        lazy="selectin",
    )
    memberships: Mapped[list[TeamMembership]] = relationship(
        "TeamMembership",
        back_populates="team",
        cascade="all, delete-orphan",
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
    __table_args__ = (
        Index("ix_players_team_active", "team_id", "deleted_at"),
        Index(
            "uq_players_public_slug",
            "public_slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND public_slug IS NOT NULL"),
        ),
    )

    team_id: Mapped[uuid.UUID] = fk_uuid("teams.id")
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    nickname: Mapped[str | None] = mapped_column(String(40), default=None)
    public_slug: Mapped[str | None] = mapped_column(String(120), default=None)
    photo_url: Mapped[str | None] = mapped_column(String(512), default=None)
    cover_url: Mapped[str | None] = mapped_column(String(512), default=None)
    date_of_birth: Mapped[date | None] = mapped_column(Date, default=None)
    nationality: Mapped[str | None] = mapped_column(String(80), default=None)
    location: Mapped[str | None] = mapped_column(String(120), default=None)
    height_cm: Mapped[float | None] = mapped_column(Float, default=None)
    weight_kg: Mapped[float | None] = mapped_column(Float, default=None)
    bio: Mapped[str | None] = mapped_column(Text, default=None)
    career_summary: Mapped[str | None] = mapped_column(Text, default=None)
    social_links: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
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
    awards: Mapped[list[PlayerAward]] = relationship(
        "PlayerAward",
        back_populates="player",
        cascade="all, delete-orphan",
        order_by="PlayerAward.awarded_at.desc()",
        lazy="selectin",
    )
