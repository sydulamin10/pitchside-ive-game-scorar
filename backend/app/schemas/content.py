"""Schemas for admin-managed site content and tutorial videos."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from app.schemas.common import ORMSchema, Schema


class TutorialOut(ORMSchema):
    id: uuid.UUID
    title: str
    youtube_id: str
    url: str
    embed_url: str
    thumbnail_url: str
    description: str | None = None
    sort_order: int
    is_active: bool
    created_at: datetime


class TutorialCreate(Schema):
    title: str = Field(min_length=1, max_length=160)
    url: str = Field(min_length=3, max_length=400)
    description: str | None = Field(default=None, max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=9999)
    is_active: bool = True


class TutorialUpdate(Schema):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    url: str | None = Field(default=None, min_length=3, max_length=400)
    description: str | None = Field(default=None, max_length=2000)
    sort_order: int | None = Field(default=None, ge=0, le=9999)
    is_active: bool | None = None


class SiteContentUpdate(Schema):
    whatsapp_number: str | None = Field(default=None, max_length=40)
    whatsapp_message: str | None = Field(default=None, max_length=240)
    exchange_rate_bdt: float | None = Field(default=None, ge=0, le=100000)
    faq: list[dict[str, Any]] | None = None
