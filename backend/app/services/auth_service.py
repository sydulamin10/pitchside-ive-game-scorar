"""Registration, login, and refresh-token rotation.

Security decisions worth knowing about:

* **Uniform failure**: a wrong email and a wrong password produce the identical
  response and comparable timing, so the endpoint is not a user enumeration
  oracle.
* **Progressive lockout**: repeated failures lock the account briefly. This sits
  *behind* the IP rate limiter, so a distributed attack still hits a wall.
* **Refresh rotation with reuse detection**: every refresh mints a new token and
  revokes the old one. Presenting an already-rotated token means it leaked, so
  the whole token family is revoked and the user is forced to sign in again.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import Conflict, Forbidden, Unauthorized
from app.core.logging import get_logger
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_opaque_token,
    hash_password,
    password_needs_rehash,
    validate_password_strength,
    verify_password,
)
from app.models.enums import AuditAction
from app.models.user import RefreshToken, User
from app.schemas.auth import RegisterRequest
from app.services import audit_service

logger = get_logger(__name__)

MAX_FAILED_LOGINS = 8
LOCKOUT_MINUTES = 15
MAX_ACTIVE_SESSIONS = 10


@dataclass(slots=True)
class IssuedTokens:
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime
    session_id: uuid.UUID


async def register(
    session: AsyncSession, payload: RegisterRequest, *, request: Request | None = None
) -> User:
    if not settings.ALLOW_REGISTRATION:
        raise Forbidden("Registration is closed on this deployment.", code="registration_closed")

    email = payload.email.strip().lower()
    validate_password_strength(payload.password, email=email)

    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        timezone=payload.timezone or "UTC",
        is_approved=settings.AUTO_APPROVE_REGISTRATION,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        # Deliberately explicit: an account page is not a login oracle, and
        # hiding this only produces confused users.
        raise Conflict(
            "An account already exists for that email address.", code="email_taken"
        ) from exc

    await audit_service.record(
        session,
        AuditAction.USER_REGISTERED,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        request=request,
    )
    return user


async def authenticate(
    session: AsyncSession, *, email: str, password: str, request: Request | None = None
) -> User:
    normalised = email.strip().lower()
    user = (
        await session.execute(select(User).where(func.lower(User.email) == normalised).limit(1))
    ).scalar_one_or_none()

    now = datetime.now(UTC)
    if user is not None and user.locked_until and user.locked_until > now:
        retry_after = int((user.locked_until - now).total_seconds())
        raise Unauthorized(
            "Too many failed attempts. Try again shortly.",
            code="account_locked",
            details={"retry_after_seconds": retry_after},
        )

    # Always run a verification so the timing does not reveal account existence.
    password_ok = verify_password(password, user.password_hash if user else None)

    if user is None or not password_ok:
        if user is not None:
            user.failed_login_count += 1
            if user.failed_login_count >= MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_count = 0
                logger.warning("account_locked", user_id=str(user.id))
            await audit_service.record(
                session,
                AuditAction.USER_LOGIN_FAILED,
                actor_user_id=user.id,
                entity_type="user",
                entity_id=user.id,
                context={"failed_count": user.failed_login_count},
                request=request,
            )
            await session.commit()
        raise Unauthorized("Email or password is incorrect.", code="invalid_credentials")

    if not user.is_active:
        raise Forbidden("This account has been disabled.", code="account_disabled")

    if not user.is_approved and not user.is_admin:
        raise Forbidden(
            "This account is waiting for admin approval. You cannot log in yet.",
            code="account_pending_approval",
        )

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    await audit_service.record(
        session,
        AuditAction.USER_LOGIN,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        request=request,
    )
    return user


async def issue_tokens(
    session: AsyncSession,
    user: User,
    *,
    request: Request | None = None,
    family_id: uuid.UUID | None = None,
) -> IssuedTokens:
    await _prune_sessions(session, user.id)

    raw_refresh = generate_refresh_token()
    record = RefreshToken(
        user_id=user.id,
        token_hash=hash_opaque_token(raw_refresh),
        family_id=family_id or uuid.uuid4(),
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.REFRESH_TOKEN_TTL_SECONDS),
        user_agent=(request.headers.get("user-agent", "")[:256] or None) if request else None,
        ip_address=getattr(request.state, "client_ip", None) if request else None,
    )
    session.add(record)
    await session.flush()

    access_token, _ = create_access_token(
        subject=str(user.id),
        session_id=str(record.id),
        extra_claims={"role": user.role.value},
    )
    return IssuedTokens(
        access_token=access_token,
        expires_in=settings.ACCESS_TOKEN_TTL_SECONDS,
        refresh_token=raw_refresh,
        refresh_expires_at=record.expires_at,
        session_id=record.id,
    )


async def rotate_refresh_token(
    session: AsyncSession, raw_token: str, *, request: Request | None = None
) -> tuple[User, IssuedTokens]:
    token_hash = hash_opaque_token(raw_token)
    record = (
        await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash).limit(1)
        )
    ).scalar_one_or_none()

    if record is None:
        raise Unauthorized("Your session has expired. Please sign in again.", code="invalid_token")

    now = datetime.now(UTC)
    if record.revoked_at is not None:
        # Someone is replaying a token we already rotated: assume compromise.
        await _revoke_family(session, record.family_id, reason="reuse_detected")
        await audit_service.record(
            session,
            AuditAction.TOKEN_REUSE_DETECTED,
            actor_user_id=record.user_id,
            entity_type="refresh_token",
            entity_id=record.id,
            context={"family_id": str(record.family_id)},
            request=request,
        )
        await session.commit()
        logger.warning("refresh_token_reuse", user_id=str(record.user_id))
        raise Unauthorized(
            "Your session is no longer valid. Please sign in again.", code="token_reused"
        )

    if record.expires_at <= now:
        raise Unauthorized("Your session has expired. Please sign in again.", code="token_expired")

    user = (
        await session.execute(select(User).where(User.id == record.user_id).limit(1))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise Unauthorized("Your session is no longer valid.", code="invalid_token")
    if not user.is_approved and not user.is_admin:
        raise Forbidden(
            "This account is waiting for admin approval. You cannot log in yet.",
            code="account_pending_approval",
        )

    issued = await issue_tokens(session, user, request=request, family_id=record.family_id)
    record.revoked_at = now
    record.revoked_reason = "rotated"
    record.replaced_by_id = issued.session_id
    return user, issued


async def revoke_session(
    session: AsyncSession, *, session_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.id == session_id,
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC), revoked_reason="logout")
    )


async def revoke_by_raw_token(session: AsyncSession, raw_token: str) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_opaque_token(raw_token),
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC), revoked_reason="logout")
    )


async def revoke_all_sessions(session: AsyncSession, user_id: uuid.UUID, *, reason: str) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )


async def change_password(
    session: AsyncSession,
    user: User,
    *,
    current_password: str,
    new_password: str,
    request: Request | None = None,
) -> None:
    if not verify_password(current_password, user.password_hash):
        raise Unauthorized("Your current password is incorrect.", code="invalid_credentials")
    validate_password_strength(new_password, email=user.email)
    user.password_hash = hash_password(new_password)
    # A password change invalidates every other session.
    await revoke_all_sessions(session, user.id, reason="password_changed")
    await audit_service.record(
        session,
        AuditAction.USER_PASSWORD_CHANGED,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        request=request,
    )


async def list_sessions(session: AsyncSession, user_id: uuid.UUID) -> list[RefreshToken]:
    result = await session.execute(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(UTC),
        )
        .order_by(RefreshToken.created_at.desc())
    )
    return list(result.scalars())


# -------------------------------------------------------------------- internals


async def _revoke_family(session: AsyncSession, family_id: uuid.UUID, *, reason: str) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )


async def _prune_sessions(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Keep the newest sessions; retire the rest so a device list stays sane."""
    active = await list_sessions(session, user_id)
    if len(active) < MAX_ACTIVE_SESSIONS:
        return
    for stale in active[MAX_ACTIVE_SESSIONS - 1 :]:
        stale.revoked_at = datetime.now(UTC)
        stale.revoked_reason = "session_limit"
