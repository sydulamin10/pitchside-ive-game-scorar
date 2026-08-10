"""Team and roster schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any

from pydantic import EmailStr, Field, StringConstraints, field_validator

from app.models.enums import BattingHand, BowlingStyle, PlayerRole
from app.schemas.common import HexColor, LongText, ORMSchema, Schema, ShortText

ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6)]
UrlField = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512)]
Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]
SocialLinks = dict[str, str]


def _normalise_social(value: dict[str, Any] | None) -> SocialLinks:
    if not value:
        return {}
    cleaned: SocialLinks = {}
    for key, raw in value.items():
        if not isinstance(key, str) or not isinstance(raw, str):
            continue
        k = key.strip().lower()[:40]
        v = raw.strip()[:512]
        if k and v:
            cleaned[k] = v
    return cleaned


class PlayerCreate(Schema):
    name: ShortText
    nickname: Nickname | None = None
    role: PlayerRole = PlayerRole.UNKNOWN
    batting_hand: BattingHand | None = None
    bowling_style: BowlingStyle | None = None
    jersey_number: int | None = Field(default=None, ge=0, le=999)
    sort_order: int | None = Field(default=None, ge=0, le=99)
    photo_url: UrlField | None = None
    cover_url: UrlField | None = None
    date_of_birth: date | None = None
    nationality: ShortText | None = None
    location: Annotated[str, StringConstraints(max_length=120)] | None = None
    height_cm: float | None = Field(default=None, ge=50, le=250)
    weight_kg: float | None = Field(default=None, ge=20, le=200)
    bio: LongText | None = None
    career_summary: LongText | None = None
    social_links: SocialLinks | None = None

    @field_validator("social_links", mode="before")
    @classmethod
    def _social(cls, value: object) -> SocialLinks:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValueError("social_links must be an object")
        return _normalise_social(value)


class PlayerUpdate(Schema):
    name: ShortText | None = None
    nickname: Nickname | None = None
    role: PlayerRole | None = None
    batting_hand: BattingHand | None = None
    bowling_style: BowlingStyle | None = None
    jersey_number: int | None = Field(default=None, ge=0, le=999)
    sort_order: int | None = Field(default=None, ge=0, le=99)
    is_active: bool | None = None
    photo_url: UrlField | None = None
    cover_url: UrlField | None = None
    date_of_birth: date | None = None
    nationality: ShortText | None = None
    location: Annotated[str, StringConstraints(max_length=120)] | None = None
    height_cm: float | None = Field(default=None, ge=50, le=250)
    weight_kg: float | None = Field(default=None, ge=20, le=200)
    bio: LongText | None = None
    career_summary: LongText | None = None
    social_links: SocialLinks | None = None

    @field_validator("social_links", mode="before")
    @classmethod
    def _social(cls, value: object) -> SocialLinks | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("social_links must be an object")
        return _normalise_social(value)


class PlayerOut(ORMSchema):
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    nickname: str | None = None
    public_slug: str | None = None
    role: PlayerRole
    batting_hand: BattingHand | None
    bowling_style: BowlingStyle | None
    jersey_number: int | None
    sort_order: int
    is_active: bool
    photo_url: str | None = None
    cover_url: str | None = None
    date_of_birth: date | None = None
    nationality: str | None = None
    location: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    bio: str | None = None
    career_summary: str | None = None
    social_links: SocialLinks = Field(default_factory=dict)
    profile_url: str | None = None


class TeamPublicBadge(ORMSchema):
    id: uuid.UUID
    name: str
    short_name: str | None = None
    public_slug: str | None = None
    logo_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    profile_url: str | None = None


class PlayerPublicOut(ORMSchema):
    id: uuid.UUID
    name: str
    nickname: str | None = None
    public_slug: str | None = None
    role: PlayerRole
    batting_hand: BattingHand | None
    bowling_style: BowlingStyle | None
    jersey_number: int | None
    photo_url: str | None = None
    cover_url: str | None = None
    date_of_birth: date | None = None
    nationality: str | None = None
    location: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    bio: str | None = None
    career_summary: str | None = None
    social_links: SocialLinks = Field(default_factory=dict)
    profile_url: str | None = None
    team: TeamPublicBadge | None = None


class TeamCreate(Schema):
    name: ShortText
    short_name: ShortName | None = None
    logo_url: UrlField | None = None
    cover_url: UrlField | None = None
    primary_color: HexColor | None = None
    secondary_color: HexColor | None = None
    home_ground: Annotated[str, StringConstraints(max_length=120)] | None = None
    founded_year: int | None = Field(default=None, ge=1800, le=2100)
    description: LongText | None = None
    coach_name: ShortText | None = None
    manager_name: ShortText | None = None
    owner_label: ShortText | None = None
    sponsor: Annotated[str, StringConstraints(max_length=120)] | None = None
    contact_email: EmailStr | None = None
    contact_phone: Phone | None = None
    social_links: SocialLinks | None = None
    players: list[PlayerCreate] = Field(default_factory=list, max_length=30)

    @field_validator("social_links", mode="before")
    @classmethod
    def _social(cls, value: object) -> SocialLinks:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValueError("social_links must be an object")
        return _normalise_social(value)


class TeamUpdate(Schema):
    name: ShortText | None = None
    short_name: ShortName | None = None
    logo_url: UrlField | None = None
    cover_url: UrlField | None = None
    primary_color: HexColor | None = None
    secondary_color: HexColor | None = None
    home_ground: Annotated[str, StringConstraints(max_length=120)] | None = None
    founded_year: int | None = Field(default=None, ge=1800, le=2100)
    description: LongText | None = None
    coach_name: ShortText | None = None
    manager_name: ShortText | None = None
    owner_label: ShortText | None = None
    sponsor: Annotated[str, StringConstraints(max_length=120)] | None = None
    contact_email: EmailStr | None = None
    contact_phone: Phone | None = None
    social_links: SocialLinks | None = None

    @field_validator("social_links", mode="before")
    @classmethod
    def _social(cls, value: object) -> SocialLinks | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("social_links must be an object")
        return _normalise_social(value)


class TeamOut(ORMSchema):
    id: uuid.UUID
    name: str
    short_name: str | None
    public_slug: str | None = None
    logo_url: str | None
    cover_url: str | None = None
    primary_color: str | None
    secondary_color: str | None = None
    home_ground: str | None
    founded_year: int | None = None
    description: str | None = None
    coach_name: str | None = None
    manager_name: str | None = None
    owner_label: str | None = None
    sponsor: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    social_links: SocialLinks = Field(default_factory=dict)
    created_at: datetime
    profile_url: str | None = None
    players: list[PlayerOut] = Field(default_factory=list, validation_alias="active_players")


class TeamPublicOut(ORMSchema):
    id: uuid.UUID
    name: str
    short_name: str | None
    public_slug: str | None = None
    logo_url: str | None
    cover_url: str | None = None
    primary_color: str | None
    secondary_color: str | None = None
    home_ground: str | None
    founded_year: int | None = None
    description: str | None = None
    coach_name: str | None = None
    manager_name: str | None = None
    owner_label: str | None = None
    sponsor: str | None = None
    social_links: SocialLinks = Field(default_factory=dict)
    profile_url: str | None = None
    players: list[PlayerOut] = Field(default_factory=list)
