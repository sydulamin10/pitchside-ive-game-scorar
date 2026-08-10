"""Team membership schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from app.models.enums import MembershipStatus, TeamMembershipRole
from app.schemas.common import ORMSchema, Schema


class InviteCreate(Schema):
    email: EmailStr
    role: TeamMembershipRole = TeamMembershipRole.PLAYER


class MemberRoleUpdate(Schema):
    role: TeamMembershipRole


class MembershipOut(ORMSchema):
    id: uuid.UUID
    team_id: uuid.UUID
    user_id: uuid.UUID | None = None
    player_id: uuid.UUID | None = None
    role: TeamMembershipRole
    status: MembershipStatus
    invited_email: str | None = None
    invite_token: str | None = Field(
        default=None,
        description="Present only on freshly created invites for the inviter to share.",
    )
    invited_by_user_id: uuid.UUID | None = None
    responded_at: datetime | None = None
    created_at: datetime
