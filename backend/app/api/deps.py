"""Shared FastAPI dependencies: authentication, authorisation, and pagination."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, NotFound, Unauthorized
from app.core.security import decode_access_token
from app.db.session import get_session
from app.models.enums import CollaboratorRole
from app.models.match import Match, MatchCollaborator
from app.models.user import RefreshToken, User

bearer_scheme = HTTPBearer(auto_error=False, description="Bearer access token")

SessionDep = Annotated[AsyncSession, Depends(get_session)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]


async def get_current_user(request: Request, session: SessionDep, credentials: Credentials) -> User:
    if credentials is None or not credentials.credentials:
        raise Unauthorized("Sign in to continue.")

    claims = decode_access_token(credentials.credentials)
    try:
        user_id = uuid.UUID(str(claims.get("sub")))
        session_id = uuid.UUID(str(claims.get("sid")))
    except (TypeError, ValueError) as exc:
        raise Unauthorized("Invalid authentication token.", code="invalid_token") from exc

    user = (
        await session.execute(select(User).where(User.id == user_id).limit(1))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise Unauthorized("Your account is no longer active.", code="account_disabled")
    if not user.is_approved and not user.is_admin:
        raise Forbidden(
            "This account is waiting for admin approval. You cannot log in yet.",
            code="account_pending_approval",
        )

    # An access token outlives an explicit sign-out by design (it is stateless and
    # short-lived), but a *revoked* session must stop working immediately, so the
    # session row is checked on every request.
    still_valid = (
        await session.execute(
            select(RefreshToken.id)
            .where(RefreshToken.id == session_id, RefreshToken.revoked_at.is_(None))
            .limit(1)
        )
    ).scalar_one_or_none()
    if still_valid is None:
        raise Unauthorized(
            "This session was signed out. Please sign in again.", code="session_revoked"
        )

    request.state.user_id = str(user.id)
    return user


async def get_optional_user(
    request: Request, session: SessionDep, credentials: Credentials
) -> User | None:
    """For endpoints that are public but richer when signed in."""
    if credentials is None or not credentials.credentials:
        return None
    try:
        return await get_current_user(request, session, credentials)
    except Unauthorized:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def require_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise Forbidden("Administrator access is required.")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


# ---------------------------------------------------------------- match access


_WRITE_ROLES = (CollaboratorRole.OWNER, CollaboratorRole.SCORER)


async def authorise_match(
    session: AsyncSession, match_id: uuid.UUID, user: User, *, write: bool
) -> None:
    """Check access with a light query rather than loading the whole match graph."""
    owner_id = (
        await session.execute(
            select(Match.created_by_user_id)
            .where(Match.id == match_id, Match.deleted_at.is_(None))
            .limit(1)
        )
    ).scalar_one_or_none()
    if owner_id is None:
        raise NotFound("That match does not exist.", code="match_not_found")
    if owner_id == user.id or user.is_admin:
        return

    role = (
        await session.execute(
            select(MatchCollaborator.role)
            .where(MatchCollaborator.match_id == match_id, MatchCollaborator.user_id == user.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if role is None:
        raise Forbidden(
            "You do not have access to this match. Ask the organiser to add you as a scorer."
        )
    if write and role not in _WRITE_ROLES:
        raise Forbidden("You have view-only access to this match.")


# ------------------------------------------------------------------ pagination


class Pagination:
    def __init__(
        self,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    ) -> None:
        self.limit = limit
        self.offset = offset


PaginationDep = Annotated[Pagination, Depends(Pagination)]
