"""Tournaments: groups, participants, and the knockout bracket."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import BracketRound, TournamentFormat, TournamentStatus

if TYPE_CHECKING:
    from app.models.match import Match


class Tournament(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "tournaments"
    __table_args__ = (
        UniqueConstraint("public_slug", name="uq_tournaments_public_slug"),
        CheckConstraint("teams_advancing_per_group >= 1", name="advancing_positive"),
        Index("ix_tournaments_owner", "created_by_user_id", "status"),
    )

    public_slug: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = fk_uuid("users.id")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    tournament_format: Mapped[TournamentFormat] = mapped_column(
        enum_type(TournamentFormat, "tournament_format"),
        nullable=False,
        default=TournamentFormat.LEAGUE,
    )
    status: Mapped[TournamentStatus] = mapped_column(
        enum_type(TournamentStatus, "tournament_status"),
        nullable=False,
        default=TournamentStatus.DRAFT,
    )
    venue: Mapped[str | None] = mapped_column(String(160), default=None)
    logo_url: Mapped[str | None] = mapped_column(String(512), default=None)

    # Default match rules inherited by fixtures created inside the tournament.
    default_overs_limit: Mapped[int | None] = mapped_column(SmallInteger, default=20)
    default_max_overs_per_bowler: Mapped[int | None] = mapped_column(SmallInteger, default=None)

    # Points system — configurable because local leagues all differ.
    points_per_win: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=2)
    points_per_tie: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    points_per_loss: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    points_per_no_result: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    use_net_run_rate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    teams_advancing_per_group: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=2)

    start_date: Mapped[date | None] = mapped_column(Date, default=None)
    end_date: Mapped[date | None] = mapped_column(Date, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    groups: Mapped[list[TournamentGroup]] = relationship(
        back_populates="tournament",
        cascade="all, delete-orphan",
        order_by="TournamentGroup.ordinal",
        lazy="selectin",
    )
    participants: Mapped[list[TournamentTeam]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan", lazy="selectin"
    )
    matches: Mapped[list[Match]] = relationship(back_populates="tournament")
    bracket: Mapped[list[BracketMatch]] = relationship(
        back_populates="tournament",
        cascade="all, delete-orphan",
        order_by="BracketMatch.ordinal",
    )


class TournamentGroup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tournament_groups"
    __table_args__ = (UniqueConstraint("tournament_id", "name", name="uq_tournament_groups_name"),)

    tournament_id: Mapped[uuid.UUID] = fk_uuid("tournaments.id")
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    ordinal: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    tournament: Mapped[Tournament] = relationship(back_populates="groups")


class TournamentTeam(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tournament_teams"
    __table_args__ = (
        UniqueConstraint("tournament_id", "team_id", name="uq_tournament_teams"),
        Index("ix_tournament_teams_group", "tournament_id", "group_id"),
    )

    tournament_id: Mapped[uuid.UUID] = fk_uuid("tournaments.id")
    team_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="CASCADE", index=False)
    group_id: Mapped[uuid.UUID | None] = fk_uuid(
        "tournament_groups.id", nullable=True, ondelete="SET NULL", index=False
    )
    seed: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    #: Manual adjustments happen in club cricket (fines, forfeits, walkovers).
    points_adjustment: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    adjustment_note: Mapped[str | None] = mapped_column(String(200), default=None)

    tournament: Mapped[Tournament] = relationship(back_populates="participants")


class BracketMatch(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A knockout slot.

    Teams may be unknown when the bracket is generated, so slots are filled by
    ``source_*_bracket_id`` (winner of an earlier slot) and resolved as results
    land.
    """

    __tablename__ = "bracket_matches"
    __table_args__ = (
        UniqueConstraint("tournament_id", "ordinal", name="uq_bracket_matches_ordinal"),
        CheckConstraint("next_slot IS NULL OR next_slot IN ('a', 'b')", name="next_slot_valid"),
    )

    tournament_id: Mapped[uuid.UUID] = fk_uuid("tournaments.id")
    round: Mapped[BracketRound] = mapped_column(
        enum_type(BracketRound, "bracket_round"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    label: Mapped[str | None] = mapped_column(String(60), default=None)

    team_a_id: Mapped[uuid.UUID | None] = fk_uuid(
        "teams.id", nullable=True, ondelete="SET NULL", index=False
    )
    team_b_id: Mapped[uuid.UUID | None] = fk_uuid(
        "teams.id", nullable=True, ondelete="SET NULL", index=False
    )
    source_a_bracket_id: Mapped[uuid.UUID | None] = fk_uuid(
        "bracket_matches.id", nullable=True, ondelete="SET NULL", index=False
    )
    source_b_bracket_id: Mapped[uuid.UUID | None] = fk_uuid(
        "bracket_matches.id", nullable=True, ondelete="SET NULL", index=False
    )
    #: Where the group stage feeds in from, e.g. "Group A #1".
    source_a_label: Mapped[str | None] = mapped_column(String(40), default=None)
    source_b_label: Mapped[str | None] = mapped_column(String(40), default=None)

    match_id: Mapped[uuid.UUID | None] = fk_uuid(
        "matches.id", nullable=True, ondelete="SET NULL", index=False
    )
    winner_team_id: Mapped[uuid.UUID | None] = fk_uuid(
        "teams.id", nullable=True, ondelete="SET NULL", index=False
    )
    next_bracket_match_id: Mapped[uuid.UUID | None] = fk_uuid(
        "bracket_matches.id", nullable=True, ondelete="SET NULL", index=False
    )
    next_slot: Mapped[str | None] = mapped_column(String(1), default=None)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    tournament: Mapped[Tournament] = relationship(back_populates="bracket")


class TournamentStandingSnapshot(TimestampMixin, Base):
    """Cached points-table row.

    Recomputed from ``innings_summaries`` whenever a result lands. Persisted (not
    only cached in Redis) so the public standings page stays correct and fast
    even with a cold cache.
    """

    __tablename__ = "tournament_standings"

    tournament_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("tournaments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="CASCADE"),
        primary_key=True,
    )
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("tournament_groups.id", ondelete="SET NULL"),
        default=None,
    )
    played: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    won: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    lost: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    tied: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    no_result: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    runs_scored: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overs_faced: Mapped[float] = mapped_column(Numeric(7, 3), nullable=False, default=0)
    runs_conceded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overs_bowled: Mapped[float] = mapped_column(Numeric(7, 3), nullable=False, default=0)
    net_run_rate: Mapped[float] = mapped_column(Numeric(7, 3), nullable=False, default=0)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
