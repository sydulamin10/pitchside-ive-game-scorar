"""Toss helpers: coin flip and random picker."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from app.schemas.common import Schema, ShortText

CoinSide = Literal["heads", "tails"]


class CoinFlipRequest(Schema):
    #: The call made *before* the flip, so the receipt records who called what.
    called_by: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None = None
    call: CoinSide | None = None


class CoinFlipResult(Schema):
    result: CoinSide
    call: CoinSide | None = None
    called_by: str | None = None
    call_correct: bool | None = None
    flipped_at: datetime
    #: HMAC over the result. Lets two captains verify afterwards that the flip
    #: they saw is the one the server produced, with no re-rolls.
    receipt: str


class SpinWheelRequest(Schema):
    options: list[ShortText] = Field(min_length=2, max_length=64)
    #: How many distinct winners to draw.
    picks: int = Field(default=1, ge=1, le=64)
    #: Draw an ordering of every option instead of picking a subset.
    shuffle_all: bool = False

    @model_validator(mode="after")
    def _picks_fit(self) -> Self:
        if len({option.lower() for option in self.options}) != len(self.options):
            raise ValueError("options must be unique")
        if self.picks > len(self.options):
            raise ValueError("picks cannot exceed the number of options")
        return self


class SpinWheelResult(Schema):
    winners: list[str]
    order: list[str]
    spun_at: datetime
    receipt: str
