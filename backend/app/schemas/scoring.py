"""Ball-by-ball scoring schemas.

These are the most safety-critical request bodies in the product, so the
validation is deliberately strict: unknown fields are rejected, ranges are
bounded, and combinations that cannot happen in cricket are refused here before
the engine is even asked.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import ExtraType, WicketType
from app.schemas.common import Schema

Commentary = Annotated[str, StringConstraints(strip_whitespace=True, max_length=280)]
MAX_RUNS_OFF_BAT = 12


class DeliveryInput(Schema):
    """One ball, exactly as the scorer tapped it."""

    striker_id: uuid.UUID
    non_striker_id: uuid.UUID
    bowler_id: uuid.UUID

    batter_runs: int = Field(default=0, ge=0, le=MAX_RUNS_OFF_BAT)
    extra_type: ExtraType | None = None
    #: Runs *in addition to* the automatic wide/no-ball penalty, or the full
    #: count of byes/leg-byes, or the size of a penalty award.
    extra_runs: int = Field(default=0, ge=0, le=12)
    #: The ball reached the rope, so the batters never crossed.
    is_boundary: bool = False
    #: Did the batters finish at opposite ends? Leave null to infer it from the
    #: runs; set it explicitly for catches and run-outs.
    batters_crossed: bool | None = None

    is_wicket: bool = False
    wicket_type: WicketType | None = None
    dismissed_player_id: uuid.UUID | None = None
    fielder_id: uuid.UUID | None = None
    replacement_batter_id: uuid.UUID | None = None

    commentary: Commentary | None = None

    @model_validator(mode="after")
    def _coherent(self) -> Self:
        if self.striker_id == self.non_striker_id:
            raise ValueError("striker_id and non_striker_id must be different players")
        if self.is_wicket and self.wicket_type is None:
            raise ValueError("wicket_type is required when is_wicket is true")
        if not self.is_wicket and (
            self.wicket_type is not None or self.dismissed_player_id is not None
        ):
            raise ValueError("wicket details require is_wicket to be true")
        if self.extra_type is None and self.extra_runs:
            raise ValueError("extra_runs requires an extra_type")
        if (
            self.extra_type in (ExtraType.WIDE, ExtraType.BYE, ExtraType.LEG_BYE)
            and self.batter_runs
        ):
            raise ValueError("batter_runs cannot accompany a wide, bye or leg-bye")
        if self.extra_type is ExtraType.PENALTY and self.extra_runs < 1:
            raise ValueError("a penalty award needs at least 1 run")
        return self


class DeliveryCreate(DeliveryInput):
    #: Client-generated id. Replaying the same id is a no-op, which is what makes
    #: offline sync and flaky-network retries safe.
    client_event_id: uuid.UUID | None = None
    occurred_at: datetime | None = None
    #: Optimistic concurrency: reject the write if the match moved on.
    expected_state_version: int | None = Field(default=None, ge=0)


class DeliveryUpdate(Schema):
    """Correction to a previously recorded ball. Only supplied fields change."""

    striker_id: uuid.UUID | None = None
    non_striker_id: uuid.UUID | None = None
    bowler_id: uuid.UUID | None = None
    batter_runs: int | None = Field(default=None, ge=0, le=MAX_RUNS_OFF_BAT)
    extra_type: ExtraType | None = None
    #: Explicitly clear the extra (``extra_type=null`` alone is ambiguous in a
    #: partial update).
    clear_extra: bool = False
    extra_runs: int | None = Field(default=None, ge=0, le=12)
    is_boundary: bool | None = None
    batters_crossed: bool | None = None
    clear_batters_crossed: bool = False
    is_wicket: bool | None = None
    wicket_type: WicketType | None = None
    dismissed_player_id: uuid.UUID | None = None
    fielder_id: uuid.UUID | None = None
    replacement_batter_id: uuid.UUID | None = None
    commentary: Commentary | None = None
    reason: Annotated[str, StringConstraints(max_length=240)] | None = None
    expected_state_version: int | None = Field(default=None, ge=0)


class DeliveryBatch(Schema):
    """Offline sync: replay a queue of deliveries in order, idempotently."""

    deliveries: list[DeliveryCreate] = Field(min_length=1, max_length=200)
    #: Stop at the first rejected ball (default) or keep going and report them.
    stop_on_error: bool = True


class DeliveryOut(Schema):
    id: uuid.UUID
    innings_id: uuid.UUID
    sequence: int
    over_number: int | None = None
    ball_in_over: int | None = None
    striker_id: uuid.UUID
    non_striker_id: uuid.UUID
    bowler_id: uuid.UUID
    batter_runs: int
    extra_type: ExtraType | None
    extra_runs: int
    is_boundary: bool
    batters_crossed: bool | None
    is_wicket: bool
    wicket_type: WicketType | None
    dismissed_player_id: uuid.UUID | None
    fielder_id: uuid.UUID | None
    replacement_batter_id: uuid.UUID | None
    commentary: str | None
    revision: int
    created_at: datetime


class DeliveryRejection(Schema):
    client_event_id: uuid.UUID | None
    index: int
    code: str
    message: str


class ScoringResult(Schema):
    """What the scoring console needs back after a write."""

    delivery_id: uuid.UUID | None = None
    state_version: int
    accepted: int = 1
    duplicates: int = 0
    rejected: list[DeliveryRejection] = Field(default_factory=list)
