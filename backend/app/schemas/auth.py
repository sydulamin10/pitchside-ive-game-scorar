"""Authentication and account schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import EmailStr, Field, StringConstraints

from app.models.enums import UserRole
from app.schemas.common import ORMSchema, Schema, ShortText

Password = Annotated[str, StringConstraints(min_length=10, max_length=256)]


class RegisterRequest(Schema):
    email: EmailStr
    password: Password
    display_name: ShortText
    timezone: Annotated[str, StringConstraints(max_length=64)] = "UTC"


class LoginRequest(Schema):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=256)]


class RefreshRequest(Schema):
    #: Optional because the token may instead arrive in an httpOnly cookie.
    refresh_token: str | None = Field(default=None, max_length=512)


class PasswordChangeRequest(Schema):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=256)]
    new_password: Password


class UserOut(ORMSchema):
    id: uuid.UUID
    email: EmailStr
    display_name: str
    role: UserRole
    is_email_verified: bool
    timezone: str
    created_at: datetime
    last_login_at: datetime | None = None


class TokenResponse(Schema):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    #: Omitted when the deployment uses httpOnly refresh cookies.
    refresh_token: str | None = None
    user: UserOut


class SessionOut(ORMSchema):
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip_address: str | None
    is_current: bool = False
