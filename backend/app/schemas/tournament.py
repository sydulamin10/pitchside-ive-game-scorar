"""Tournament, fixture, and bracket schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import BracketRound, MatchFormat, TournamentFormat, TournamentStatus
from app.schemas.common import LongText, MediumText, ORMSchema, Schema, ShortText


class PointsSystemInput(Schema):
    points_per_win: int = Field(default=2, ge=0, le=20)
    points_per_tie: int = Field(default=1, ge=0, le=20)
    points_per_loss: int = Field(default=0, ge=0, le=20)
    points_per_no_result: int = Field(default=1, ge=0, le=20)
    use_net_run_rate: bool = True


class TournamentCreate(Schema):
    name: MediumText
    description: LongText | None = None
    tournament_format: TournamentFormat = TournamentFormat.LEAGUE
    venue: MediumText | None = None
    logo_url: Annotated[str, StringConstraints(max_length=512)] | None = None
    default_overs_limit: int | None = Field(default=20, ge=1, le=200)
    default_max_overs_per_bowler: int | None = Field(default=None, ge=1, le=200)
    points: PointsSystemInput = Field(default_factory=PointsSystemInput)
    teams_advancing_per_group: int = Field(default=2, ge=1, le=8)
    start_date: date | None = None
    end_date: date | None = None
    #: Existing saved teams to enter straight away.
    team_ids: list[uuid.UUID] = Field(default_factory=list, max_length=64)
    #: Group names to create up front, e.g. ["Group A", "Group B"].
    groups: list[ShortText] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def _dates_ordered(self) -> Self:
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class TournamentUpdate(Schema):
    name: MediumText | None = None
    description: LongText | None = None
    venue: MediumText | None = None
    logo_url: Annotated[str, StringConstraints(max_length=512)] | None = None
    status: TournamentStatus | None = None
    default_overs_limit: int | None = Field(default=None, ge=1, le=200)
    default_max_overs_per_bowler: int | None = Field(default=None, ge=1, le=200)
    points: PointsSystemInput | None = None
    teams_advancing_per_group: int | None = Field(default=None, ge=1, le=8)
    start_date: date | None = None
    end_date: date | None = None


class GroupCreate(Schema):
    name: ShortText
    ordinal: int | None = Field(default=None, ge=0, le=99)


class ParticipantInput(Schema):
    team_id: uuid.UUID
    group_id: uuid.UUID | None = None
    seed: int | None = Field(default=None, ge=1, le=64)


class ParticipantsAdd(Schema):
    participants: list[ParticipantInput] = Field(min_length=1, max_length=64)


class PointsAdjustment(Schema):
    team_id: uuid.UUID
    points_adjustment: int = Field(ge=-50, le=50)
    note: MediumText | None = None


class FixtureInput(Schema):
    team_a_id: uuid.UUID
    team_b_id: uuid.UUID
    scheduled_at: datetime | None = None
    venue: MediumText | None = None
    group_id: uuid.UUID | None = None
    round_label: Annotated[str, StringConstraints(max_length=40)] | None = None
    overs_limit: int | None = Field(default=None, ge=1, le=200)
    match_format: MatchFormat | None = None

    @model_validator(mode="after")
    def _teams_differ(self) -> Self:
        if self.team_a_id == self.team_b_id:
            raise ValueError("A fixture needs two different teams")
        return self


class FixturesCreate(Schema):
    fixtures: list[FixtureInput] = Field(min_length=1, max_length=128)


class RoundRobinGenerate(Schema):
    """Auto-generate a round robin, optionally within each group."""

    double_round: bool = False
    start_date: datetime | None = None
    #: Minutes between consecutive fixtures when auto-scheduling.
    interval_minutes: int = Field(default=180, ge=30, le=1440)
    venue: MediumText | None = None
    overs_limit: int | None = Field(default=None, ge=1, le=200)


class BracketGenerate(Schema):
    """Build a single-elimination bracket from the group standings."""

    teams_advancing_per_group: int | None = Field(default=None, ge=1, le=8)
    include_third_place: bool = False
    #: Seed from the live standings now, or leave the slots to be filled later.
    seed_from_standings: bool = True


class BracketSlotUpdate(Schema):
    team_a_id: uuid.UUID | None = None
    team_b_id: uuid.UUID | None = None
    match_id: uuid.UUID | None = None
    winner_team_id: uuid.UUID | None = None
    scheduled_at: datetime | None = None


class GroupOut(ORMSchema):
    id: uuid.UUID
    name: str
    ordinal: int


class ParticipantOut(Schema):
    id: uuid.UUID
    team_id: uuid.UUID
    team_name: str
    short_name: str | None = None
    logo_url: str | None = None
    group_id: uuid.UUID | None = None
    group_name: str | None = None
    seed: int | None = None
    points_adjustment: int = 0


class TournamentOut(ORMSchema):
    id: uuid.UUID
    public_slug: str
    name: str
    description: str | None
    tournament_format: TournamentFormat
    status: TournamentStatus
    venue: str | None
    logo_url: str | None
    default_overs_limit: int | None
    default_max_overs_per_bowler: int | None
    points_per_win: int
    points_per_tie: int
    points_per_loss: int
    points_per_no_result: int
    use_net_run_rate: bool
    teams_advancing_per_group: int
    start_date: date | None
    end_date: date | None
    created_at: datetime
    groups: list[GroupOut] = Field(default_factory=list)
    share_url: str | None = None
    team_count: int = 0
    match_count: int = 0


class BracketMatchOut(Schema):
    id: uuid.UUID
    round: BracketRound
    ordinal: int
    label: str | None
    team_a_id: uuid.UUID | None
    team_a_name: str | None
    team_b_id: uuid.UUID | None
    team_b_name: str | None
    source_a_label: str | None
    source_b_label: str | None
    match_id: uuid.UUID | None
    match_slug: str | None = None
    winner_team_id: uuid.UUID | None
    next_bracket_match_id: uuid.UUID | None
    scheduled_at: datetime | None
    score_line: str | None = None
