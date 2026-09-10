"""Stream session schemas."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import StringConstraints

from app.schemas.common import Schema

Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
UrlField = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]
PathField = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
StreamKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=4, max_length=128)]


class StreamSessionCreate(Schema):
    destination_label: Label | None = None
    rtmp_url: UrlField | None = None
    stream_key: StreamKey | None = None
    whip_path: PathField | None = None


class StreamDestinationUpdate(Schema):
    destination_label: Label | None = None
    rtmp_url: UrlField | None = None
    stream_key: StreamKey | None = None
    whip_path: PathField | None = None


class CameraJoinIn(Schema):
    """Each phone / this-device camera gets its own WHIP path under the match."""

    device_id: str | None = None


class CameraGoLiveIn(Schema):
    device_id: str | None = None
    whip_path: str | None = None


class CameraEndIn(Schema):
    device_id: str | None = None
    whip_path: str | None = None


SocialKind = Literal["facebook_page", "facebook_group", "facebook_profile"]


class SocialSelectIn(Schema):
    kind: SocialKind
    id: str | None = None
