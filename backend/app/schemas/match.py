"""Match setup and lifecycle schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import (
    CollaboratorRole,
    InningsEndReason,
    MatchFormat,
    MatchResultType,
    MatchStatus,
    TossDecision,
)
from app.schemas.common import MediumText, ORMSchema, Schema, ShortText

MAX_SQUAD = 20


class SquadPlayerInput(Schema):
    """A player selected for the match: either a saved player or a walk-up guest."""

    player_id: uuid.UUID | None = None
    name: ShortText | None = None
    batting_order: int | None = Field(default=None, ge=1, le=MAX_SQUAD)
    is_captain: bool = False
    is_wicket_keeper: bool = False
    is_playing: bool = True

    @model_validator(mode="after")
    def _require_identity(self) -> Self:
        if self.player_id is None and not self.name:
            raise ValueError("Provide either player_id or name for each squad member")
        return self


class MatchTeamInput(Schema):
    """Either an existing saved team, or a brand new one created inline."""

    team_id: uuid.UUID | None = None
    name: ShortText | None = None
    short_name: Annotated[str, StringConstraints(max_length=6)] | None = None
    players: list[SquadPlayerInput] = Field(default_factory=list, max_length=MAX_SQUAD)

    @model_validator(mode="after")
    def _require_identity(self) -> Self:
        if self.team_id is None and not self.name:
            raise ValueError("Provide either team_id or name for each team")
        return self


class MatchRulesInput(Schema):
    overs_limit: int | None = Field(default=20, ge=1, le=200)
    balls_per_over: int = Field(default=6, ge=1, le=12)
    players_per_side: int = Field(default=11, ge=2, le=15)
    max_overs_per_bowler: int | None = Field(default=None, ge=1, le=200)
    wide_penalty_runs: int = Field(default=1, ge=0, le=5)
    no_ball_penalty_runs: int = Field(default=1, ge=0, le=5)
    free_hit_after_no_ball: bool = True
    allow_boundaries: bool = True
    last_batter_can_bat_alone: bool = False
    dls_enabled: bool = False
    overrides: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_bowler_quota(self) -> Self:
        if (
            self.max_overs_per_bowler is not None
            and self.overs_limit is not None
            and self.max_overs_per_bowler > self.overs_limit
        ):
            raise ValueError("max_overs_per_bowler cannot exceed the innings overs limit")
        return self


class TossInput(Schema):
    winner_team_id: uuid.UUID
    decision: TossDecision


class MatchCreate(Schema):
    title: MediumText | None = None
    venue: MediumText | None = None
    city: ShortText | None = None
    match_format: MatchFormat = MatchFormat.T20
    rules: MatchRulesInput = Field(default_factory=MatchRulesInput)
    team_a: MatchTeamInput
    team_b: MatchTeamInput
    toss: TossInput | None = None
    scheduled_at: datetime | None = None
    tournament_id: uuid.UUID | None = None
    tournament_group_id: uuid.UUID | None = None
    tournament_round: Annotated[str, StringConstraints(max_length=40)] | None = None

    @model_validator(mode="after")
    def _teams_must_differ(self) -> Self:
        if self.team_a.team_id is not None and self.team_a.team_id == self.team_b.team_id:
            raise ValueError("A match needs two different teams")
        return self


class MatchUpdate(Schema):
    title: MediumText | None = None
    venue: MediumText | None = None
    city: ShortText | None = None
    scheduled_at: datetime | None = None
    rules: MatchRulesInput | None = None
    toss: TossInput | None = None
    expected_state_version: int | None = Field(default=None, ge=0)


class SquadUpdate(Schema):
    team_id: uuid.UUID
    players: list[SquadPlayerInput] = Field(min_length=1, max_length=MAX_SQUAD)


class InningsCreate(Schema):
    batting_team_id: uuid.UUID | None = None
    overs_limit: int | None = Field(default=None, ge=1, le=200)
    target_runs: int | None = Field(default=None, ge=1, le=2000)
    is_super_over: bool = False
    is_follow_on: bool = False


class OverlaySponsorItem(Schema):
    id: str | None = Field(default=None, max_length=40)
    url: str = Field(max_length=500)
    on: bool = True


class OverlayDirectorUpdate(Schema):
    """What the live camera / OBS overlay should show."""

    panel: (
        Literal[
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
        ]
        | None
    ) = None
    ticker: str | None = Field(default=None, max_length=400)
    ticker_on: bool | None = None
    show_tournament: bool | None = None
    design: str | None = Field(default=None, max_length=32)
    brand_mode: Literal["none", "name", "logo"] | None = None
    brand_name: str | None = Field(default=None, max_length=80)
    brand_logo_url: str | None = Field(default=None, max_length=500)
    sponsor_logo_url: str | None = Field(default=None, max_length=500)
    sponsor_on: bool | None = None
    sponsors: list[OverlaySponsorItem] | None = None
    sponsor_layout: Literal["corner", "grid", "fullscreen"] | None = None
    scorebar_on: bool | None = None
    logo_on: bool | None = None
    player_card_on: bool | None = None
    anim_four: bool | None = None
    anim_six: bool | None = None
    anim_wicket: bool | None = None
    anim_extras: bool | None = None
    anim_cue: str | None = Field(default=None, max_length=64)
    clean: bool | None = None
    scorebar_pos: Literal["top", "center", "bottom"] | None = None
    logo_pos: Literal["top-left", "top-right", "bottom-left", "bottom-right"] | None = None
    sponsor_pos: Literal["top-right", "top-left", "center", "bottom", "fullscreen"] | None = None
    deck_pos: Literal["top", "center", "bottom"] | None = None
    summary_until: str | None = Field(default=None, max_length=64)


class InningsClose(Schema):
    end_reason: InningsEndReason = InningsEndReason.DECLARED
    note: MediumText | None = None


class MatchCompleteRequest(Schema):
    result_type: MatchResultType | None = None
    winner_team_id: uuid.UUID | None = None
    result_summary: MediumText | None = None


class CollaboratorInvite(Schema):
    email: Annotated[str, StringConstraints(max_length=320)]
    role: CollaboratorRole = CollaboratorRole.SCORER


class MatchListItem(ORMSchema):
    id: uuid.UUID
    public_slug: str
    title: str | None
    status: MatchStatus
    match_format: MatchFormat
    venue: str | None
    scheduled_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    result_summary: str | None
    state_version: int
    team_a_name: str | None = None
    team_b_name: str | None = None
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    tournament_id: uuid.UUID | None = None
    score_line: str | None = None
