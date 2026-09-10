"""Operator-facing settings payloads."""

from __future__ import annotations

from typing import Annotated

from pydantic import StringConstraints

from app.schemas.common import Schema

AppId = Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]
AppSecret = Annotated[str, StringConstraints(strip_whitespace=True, max_length=128)]


class FacebookSettingsUpdate(Schema):
    app_id: AppId = ""
    app_secret: AppSecret | None = None
