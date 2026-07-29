"""Team and roster schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from app.models.enums import BattingHand, BowlingStyle, PlayerRole
from app.schemas.common import HexColor, ORMSchema, Schema, ShortText

ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6)]


class PlayerCreate(Schema):
    name: ShortText
    role: PlayerRole = PlayerRole.UNKNOWN
    batting_hand: BattingHand | None = None
    bowling_style: BowlingStyle | None = None
    jersey_number: int | None = Field(default=None, ge=0, le=999)
    sort_order: int | None = Field(default=None, ge=0, le=99)


class PlayerUpdate(Schema):
    name: ShortText | None = None
    role: PlayerRole | None = None
    batting_hand: BattingHand | None = None
    bowling_style: BowlingStyle | None = None
    jersey_number: int | None = Field(default=None, ge=0, le=999)
    sort_order: int | None = Field(default=None, ge=0, le=99)
    is_active: bool | None = None


class PlayerOut(ORMSchema):
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    role: PlayerRole
    batting_hand: BattingHand | None
    bowling_style: BowlingStyle | None
    jersey_number: int | None
    sort_order: int
    is_active: bool


class TeamCreate(Schema):
    name: ShortText
    short_name: ShortName | None = None
    logo_url: Annotated[str, StringConstraints(max_length=512)] | None = None
    primary_color: HexColor | None = None
    home_ground: Annotated[str, StringConstraints(max_length=120)] | None = None
    players: list[PlayerCreate] = Field(default_factory=list, max_length=30)


class TeamUpdate(Schema):
    name: ShortText | None = None
    short_name: ShortName | None = None
    logo_url: Annotated[str, StringConstraints(max_length=512)] | None = None
    primary_color: HexColor | None = None
    home_ground: Annotated[str, StringConstraints(max_length=120)] | None = None


class TeamOut(ORMSchema):
    id: uuid.UUID
    name: str
    short_name: str | None
    logo_url: str | None
    primary_color: str | None
    home_ground: str | None
    created_at: datetime
    players: list[PlayerOut] = Field(default_factory=list, validation_alias="active_players")
