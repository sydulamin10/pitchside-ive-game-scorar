"""Shared schema building blocks."""

from __future__ import annotations

from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

T = TypeVar("T")

#: Trimmed, non-empty short text (names, titles). ``strict`` rejects coercion
#: from ints/None, which stops sloppy clients writing "None" into a team name.
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
MediumText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
HexColor = Annotated[str, StringConstraints(pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")]


class Schema(BaseModel):
    """Base for request bodies: unknown fields are refused, not ignored."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ORMSchema(BaseModel):
    """Base for responses built from ORM objects."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
    has_more: bool


class PaginationParams(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class Message(BaseModel):
    message: str
    detail: dict[str, Any] | None = None
