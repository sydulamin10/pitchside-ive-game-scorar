"""Media upload schemas (R2 signed PUT or local development store)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.schemas.common import Schema

MediaKind = Literal["team_logo", "team_cover", "player_photo", "player_cover", "generic"]
ContentType = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        pattern=r"^image/(jpeg|png|webp|gif)$",
    ),
]


class MediaUploadUrlRequest(Schema):
    kind: MediaKind = "generic"
    content_type: ContentType
    filename: Annotated[str, StringConstraints(strip_whitespace=True, max_length=180)] | None = None
    content_length: int | None = Field(default=None, ge=1, le=10_485_760)


class MediaUploadUrlResponse(Schema):
    upload_url: str
    public_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    object_key: str
    expires_at: datetime
    backend: Literal["local", "r2"]
