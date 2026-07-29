"""Column helpers shared by the ORM models."""

from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any, TypeVar

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

E = TypeVar("E", bound=StrEnum)


def enum_type(enum_cls: type[E], name: str) -> SAEnum:
    """Persist an enum as VARCHAR + CHECK rather than a native PG enum.

    Native Postgres enums require a migration (and an exclusive lock) to add a
    value; a checked VARCHAR gives the same integrity with far cheaper
    evolution, which matters because cricket edge cases keep appearing.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        length=40,
        validate_strings=True,
        values_callable=lambda cls: [member.value for member in cls],
    )


def fk_uuid(
    target: str,
    *,
    nullable: bool = False,
    ondelete: str = "CASCADE",
    index: bool = True,
    **kwargs: Any,
) -> Mapped[uuid.UUID]:
    return mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
        index=index,
        **kwargs,
    )
