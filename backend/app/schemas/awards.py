"""Award request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from typing import Annotated

from pydantic import StringConstraints

from app.models.enums import AwardKind
from app.schemas.common import LongText, MediumText, ORMSchema, Schema

UrlField = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512)]


class AwardCreate(Schema):
    kind: AwardKind = AwardKind.ACHIEVEMENT
    title: MediumText
    description: LongText | None = None
    awarded_at: datetime | None = None
    image_url: UrlField | None = None


class AwardUpdate(Schema):
    kind: AwardKind | None = None
    title: MediumText | None = None
    description: LongText | None = None
    awarded_at: datetime | None = None
    image_url: UrlField | None = None


class AwardOut(ORMSchema):
    id: uuid.UUID
    player_id: uuid.UUID
    team_id: uuid.UUID | None = None
    kind: AwardKind
    title: str
    description: str | None = None
    awarded_at: datetime
    image_url: str | None = None
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime
