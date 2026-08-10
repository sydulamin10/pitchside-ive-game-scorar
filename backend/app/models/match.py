"""Matches, squads, innings, and the append-only delivery log.

The single source of truth for everything that happened in a match is the
``deliveries`` table. Team totals, batting/bowling cards, partnerships, fall of
wickets and run rates are **never** authored by hand — they are produced by
:mod:`app.scoring.engine` from the ordered delivery log.

``innings_summaries`` is the one exception, and it is explicitly a *projection*:
it is rewritten inside the same transaction as every delivery mutation so that
list views and tournament standings can be answered with plain SQL instead of
replaying every ball. If it ever disagreed with the log, the log wins and the
projection is rebuilt (``POST /matches/{id}/rebuild``).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import (
    CollaboratorRole,
    ExtraType,
    InningsEndReason,
    InningsStatus,
    MatchFormat,
    MatchResultType,
    MatchStatus,
    TossDecision,
    WicketType,
)

if TYPE_CHECKING:
    from app.models.stream import StreamSession
    from app.models.team import Player, Team
    from app.models.tournament import Tournament


class Match(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("public_slug", name="uq_matches_public_slug"),
        CheckConstraint("overs_limit IS NULL OR overs_limit > 0", name="overs_limit_positive"),
        CheckConstraint("balls_per_over BETWEEN 1 AND 12", name="balls_per_over_range"),
        CheckConstraint("players_per_side BETWEEN 2 AND 15", name="players_per_side_range"),
        CheckConstraint("team_a_id <> team_b_id", name="teams_differ"),
        Index("ix_matches_owner_status", "created_by_user_id", "status"),
        Index("ix_matches_tournament", "tournament_id", "status"),
    )

    public_slug: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    tournament_id: Mapped[uuid.UUID | None] = fk_uuid(
        "tournaments.id", nullable=True, ondelete="SET NULL"
    )
    team_a_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="RESTRICT")
    team_b_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="RESTRICT")

    title: Mapped[str | None] = mapped_column(String(160), default=None)
    venue: Mapped[str | None] = mapped_column(String(160), default=None)
    city: Mapped[str | None] = mapped_column(String(80), default=None)
    match_format: Mapped[MatchFormat] = mapped_column(
        enum_type(MatchFormat, "match_format"), nullable=False, default=MatchFormat.T20
    )
    status: Mapped[MatchStatus] = mapped_column(
        enum_type(MatchStatus, "match_status"),
        nullable=False,
        default=MatchStatus.SETUP,
        index=True,
    )

    # ------------------------------------------------------------- rule set
    overs_limit: Mapped[int | None] = mapped_column(SmallInteger, default=20)
    balls_per_over: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=6)
    players_per_side: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=11)
    max_overs_per_bowler: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    wide_penalty_runs: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    no_ball_penalty_runs: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    free_hit_after_no_ball: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_boundaries: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_batter_can_bat_alone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dls_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Escape hatch for niche local rules (e.g. "one-tip-one-hand", "joker over")
    #: without a migration per variant.
    rule_overrides: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    # ----------------------------------------------------------------- toss
    toss_winner_team_id: Mapped[uuid.UUID | None] = fk_uuid(
        "teams.id", nullable=True, ondelete="SET NULL", index=False
    )
    toss_decision: Mapped[TossDecision | None] = mapped_column(
        enum_type(TossDecision, "toss_decision"), default=None
    )

    # --------------------------------------------------------------- result
    result_type: Mapped[MatchResultType | None] = mapped_column(
        enum_type(MatchResultType, "match_result_type"), default=None
    )
    winner_team_id: Mapped[uuid.UUID | None] = fk_uuid(
        "teams.id", nullable=True, ondelete="SET NULL", index=False
    )
    result_summary: Mapped[str | None] = mapped_column(String(240), default=None)
    win_margin_runs: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    win_margin_wickets: Mapped[int | None] = mapped_column(SmallInteger, default=None)

    # ------------------------------------------------------------- lifecycle
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    #: Bumped on every mutation. Clients send it back for optimistic concurrency
    #: and SSE consumers use it to discard out-of-order or replayed frames.
    state_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    tournament_round: Mapped[str | None] = mapped_column(String(40), default=None)
    tournament_group_id: Mapped[uuid.UUID | None] = fk_uuid(
        "tournament_groups.id", nullable=True, ondelete="SET NULL", index=False
    )

    team_a: Mapped[Team] = relationship(foreign_keys=[team_a_id], lazy="joined")
    team_b: Mapped[Team] = relationship(foreign_keys=[team_b_id], lazy="joined")
    tournament: Mapped[Tournament | None] = relationship(back_populates="matches")
    squad: Mapped[list[MatchPlayer]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    innings: Mapped[list[Innings]] = relationship(
        back_populates="match", cascade="all, delete-orphan", order_by="Innings.sequence"
    )
    collaborators: Mapped[list[MatchCollaborator]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    stream_sessions: Mapped[list[StreamSession]] = relationship(
        "StreamSession",
        back_populates="match",
        cascade="all, delete-orphan",
    )

    @property
    def is_limited_overs(self) -> bool:
        return self.match_format is not MatchFormat.TEST and self.overs_limit is not None


class MatchPlayer(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A player *as selected for this match*.

    Deliveries reference this row rather than ``players.id`` so that ad-hoc
    guests ("the neighbour who made up the numbers") are first-class, and so
    that renaming a saved player later never rewrites history.
    """

    __tablename__ = "match_players"
    __table_args__ = (
        UniqueConstraint("match_id", "team_id", "batting_order", name="uq_match_players_order"),
        Index("ix_match_players_match_team", "match_id", "team_id"),
        CheckConstraint("batting_order BETWEEN 1 AND 20", name="batting_order_range"),
    )

    match_id: Mapped[uuid.UUID] = fk_uuid("matches.id")
    team_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="RESTRICT", index=False)
    player_id: Mapped[uuid.UUID | None] = fk_uuid(
        "players.id", nullable=True, ondelete="SET NULL", index=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    batting_order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    is_captain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_wicket_keeper: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_playing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_substitute: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    match: Mapped[Match] = relationship(back_populates="squad")
    player: Mapped[Player | None] = relationship("Player", lazy="selectin")


class MatchCollaborator(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Lets a captain hand the phone to someone else without sharing a password."""

    __tablename__ = "match_collaborators"
    __table_args__ = (UniqueConstraint("match_id", "user_id", name="uq_match_collaborators"),)

    match_id: Mapped[uuid.UUID] = fk_uuid("matches.id")
    user_id: Mapped[uuid.UUID] = fk_uuid("users.id")
    role: Mapped[CollaboratorRole] = mapped_column(
        enum_type(CollaboratorRole, "collaborator_role"),
        nullable=False,
        default=CollaboratorRole.SCORER,
    )
    invited_by_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        "users.id", nullable=True, ondelete="SET NULL", index=False
    )

    match: Mapped[Match] = relationship(back_populates="collaborators")


class Innings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "innings"
    __table_args__ = (
        UniqueConstraint("match_id", "sequence", name="uq_innings_match_sequence"),
        CheckConstraint("sequence BETWEEN 1 AND 8", name="sequence_range"),
        CheckConstraint("batting_team_id <> bowling_team_id", name="innings_teams_differ"),
    )

    match_id: Mapped[uuid.UUID] = fk_uuid("matches.id")
    sequence: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    batting_team_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="RESTRICT", index=False)
    bowling_team_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="RESTRICT", index=False)
    status: Mapped[InningsStatus] = mapped_column(
        enum_type(InningsStatus, "innings_status"), nullable=False, default=InningsStatus.PENDING
    )
    #: May differ from the match default after a rain reduction.
    overs_limit: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    #: Runs required to win. Set for every chasing innings (DLS-revised or not).
    target_runs: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    is_super_over: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_follow_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    end_reason: Mapped[InningsEndReason | None] = mapped_column(
        enum_type(InningsEndReason, "innings_end_reason"), default=None
    )
    #: Penalty runs awarded to the batting side that are not tied to a delivery.
    penalty_runs: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    #: Monotonic high-water mark for delivery ordering. Never reused, so gaps
    #: from deleted balls are expected and harmless.
    next_delivery_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    match: Mapped[Match] = relationship(back_populates="innings")
    deliveries: Mapped[list[Delivery]] = relationship(
        back_populates="innings",
        cascade="all, delete-orphan",
        order_by="Delivery.sequence",
    )
    summary: Mapped[InningsSummary | None] = relationship(
        back_populates="innings", cascade="all, delete-orphan", uselist=False, lazy="selectin"
    )


class Delivery(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One ball (or one non-ball event such as a 5-run penalty).

    Only the *facts of the delivery* are stored. Over/ball numbering, strike
    rotation outcomes, and every aggregate are derived, so editing a ball in the
    middle of an innings cannot leave stale numbers behind.
    """

    __tablename__ = "deliveries"
    __table_args__ = (
        UniqueConstraint("innings_id", "sequence", name="uq_deliveries_innings_sequence"),
        UniqueConstraint("innings_id", "client_event_id", name="uq_deliveries_client_event"),
        CheckConstraint("batter_runs BETWEEN 0 AND 12", name="batter_runs_range"),
        CheckConstraint("extra_runs BETWEEN 0 AND 12", name="extra_runs_range"),
        CheckConstraint(
            "(is_wicket = false AND wicket_type IS NULL) OR "
            "(is_wicket = true AND wicket_type IS NOT NULL)",
            name="wicket_type_requires_wicket",
        ),
        CheckConstraint("striker_id <> non_striker_id", name="batters_differ"),
        Index("ix_deliveries_innings_seq", "innings_id", "sequence"),
    )

    innings_id: Mapped[uuid.UUID] = fk_uuid("innings.id")
    #: Position in the innings. Strictly increasing; gaps allowed.
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    striker_id: Mapped[uuid.UUID] = fk_uuid("match_players.id", ondelete="RESTRICT", index=False)
    non_striker_id: Mapped[uuid.UUID] = fk_uuid(
        "match_players.id", ondelete="RESTRICT", index=False
    )
    bowler_id: Mapped[uuid.UUID] = fk_uuid("match_players.id", ondelete="RESTRICT", index=False)

    batter_runs: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    extra_type: Mapped[ExtraType | None] = mapped_column(
        enum_type(ExtraType, "extra_type"), default=None
    )
    #: Extras *in addition to* the automatic penalty for a wide/no-ball; the full
    #: count of byes or leg-byes; or the size of a penalty award.
    extra_runs: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    #: True when the runs came off the bat/keeper to the rope, which means the
    #: batters did not physically cross — the engine needs this to get strike
    #: rotation right on boundary wides and boundary byes.
    is_boundary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Explicit crossing override for catches and run-outs, where crossing is not
    #: implied by the number of runs.
    batters_crossed: Mapped[bool | None] = mapped_column(Boolean, default=None)

    is_wicket: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    wicket_type: Mapped[WicketType | None] = mapped_column(
        enum_type(WicketType, "wicket_type"), default=None
    )
    dismissed_player_id: Mapped[uuid.UUID | None] = fk_uuid(
        "match_players.id", nullable=True, ondelete="RESTRICT", index=False
    )
    fielder_id: Mapped[uuid.UUID | None] = fk_uuid(
        "match_players.id", nullable=True, ondelete="RESTRICT", index=False
    )
    #: Batter who replaces the dismissed one. Recorded on the delivery so that a
    #: replay of the log reproduces the batting order exactly.
    replacement_batter_id: Mapped[uuid.UUID | None] = fk_uuid(
        "match_players.id", nullable=True, ondelete="RESTRICT", index=False
    )

    commentary: Mapped[str | None] = mapped_column(Text, default=None)
    revision: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    recorded_by_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        "users.id", nullable=True, ondelete="SET NULL", index=False
    )
    #: Client-generated UUID. Makes offline replay and network retries idempotent.
    client_event_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), default=None)
    #: When the scorer actually tapped the button (may be well before sync).
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    innings: Mapped[Innings] = relationship(back_populates="deliveries")


class DeliveryRevision(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Immutable correction log: the previous value of every edited delivery."""

    __tablename__ = "delivery_revisions"
    __table_args__ = (Index("ix_delivery_revisions_delivery", "delivery_id", "revision"),)

    delivery_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    innings_id: Mapped[uuid.UUID] = fk_uuid("innings.id")
    revision: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    change_kind: Mapped[str] = mapped_column(String(16), nullable=False)  # edit | delete
    previous_state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    new_state: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    reason: Mapped[str | None] = mapped_column(String(240), default=None)
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )


class InningsSummary(TimestampMixin, Base):
    """Derived projection of an innings — rebuilt on every delivery mutation.

    Exists purely so that "list my matches" and "recompute the points table"
    don't have to replay ball logs. Never write to it outside
    :mod:`app.services.scoring_service`.
    """

    __tablename__ = "innings_summaries"

    innings_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("innings.id", ondelete="CASCADE"),
        primary_key=True,
    )
    match_id: Mapped[uuid.UUID] = fk_uuid("matches.id")
    batting_team_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="CASCADE", index=False)
    bowling_team_id: Mapped[uuid.UUID] = fk_uuid("teams.id", ondelete="CASCADE", index=False)

    total_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_wickets: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    legal_balls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overs_text: Mapped[str] = mapped_column(String(12), nullable=False, default="0.0")
    #: Overs charged for NRR: the full quota when a side is bowled out.
    nrr_overs: Mapped[float] = mapped_column(Numeric(6, 3), nullable=False, default=0)
    extras_wide: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    extras_no_ball: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    extras_bye: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    extras_leg_bye: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    extras_penalty: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    run_rate: Mapped[float] = mapped_column(Numeric(6, 3), nullable=False, default=0)
    is_all_out: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    delivery_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    innings: Mapped[Innings] = relationship(back_populates="summary")
