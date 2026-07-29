"""Password hashing, token minting, and other cryptographic primitives.

Design notes
------------
* Passwords use **Argon2id** (memory-hard, the current OWASP recommendation).
  Hash parameters live in settings so they can be raised as hardware improves;
  ``needs_rehash`` lets us transparently upgrade stored hashes on login.
* **Access tokens** are short-lived signed JWTs — stateless, cheap to verify.
* **Refresh tokens** are opaque 384-bit random strings; only a SHA-256 digest is
  persisted. That makes them revocable, unusable if the database leaks, and
  enables *reuse detection*: replaying a rotated token kills the whole family.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import unicodedata
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import HashingError, InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import settings
from app.core.errors import BadRequest, Unauthorized

TokenType = Literal["access", "refresh", "overlay"]

_ISSUER: Final = "pitchside"
_AUDIENCE: Final = "pitchside-api"

_hasher = PasswordHasher(
    time_cost=settings.ARGON2_TIME_COST,
    memory_cost=settings.ARGON2_MEMORY_COST_KIB,
    parallelism=settings.ARGON2_PARALLELISM,
    hash_len=32,
    salt_len=16,
)

# A dummy hash of the same shape, used to keep failed-login timing flat.
_DUMMY_HASH: Final = _hasher.hash("timing-equalisation-placeholder")

_COMMON_PASSWORDS: Final = frozenset(
    {
        "password",
        "password1",
        "password123",
        "12345678",
        "123456789",
        "1234567890",
        "qwertyuiop",
        "iloveyou",
        "letmein123",
        "adminadmin",
        "cricket123",
        "welcome123",
    }
)


# --------------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    try:
        return _hasher.hash(password)
    except HashingError as exc:  # pragma: no cover - only on OOM
        raise BadRequest("Password could not be processed.") from exc


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-ish time verification that never reveals whether a user exists."""
    candidate = password_hash or _DUMMY_HASH
    try:
        _hasher.verify(candidate, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return password_hash is not None


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:  # pragma: no cover
        return True


def validate_password_strength(password: str, *, email: str | None = None) -> None:
    """Reject weak passwords with actionable messages (NIST-style rules).

    We deliberately avoid arbitrary composition rules beyond a light check and
    instead lean on length plus a blocklist, which is what actually helps.
    """
    normalised = unicodedata.normalize("NFKC", password)
    minimum = settings.PASSWORD_MIN_LENGTH
    if len(normalised) < minimum:
        raise BadRequest(
            f"Password must be at least {minimum} characters.",
            code="weak_password",
            details={"reason": "too_short", "min_length": minimum},
        )
    if len(normalised.encode()) > 1024:
        raise BadRequest(
            "Password must be shorter than 1024 bytes.",
            code="weak_password",
            details={"reason": "too_long"},
        )
    lowered = normalised.lower()
    if lowered in _COMMON_PASSWORDS:
        raise BadRequest(
            "That password is too common. Pick something less guessable.",
            code="weak_password",
            details={"reason": "common_password"},
        )
    if len(set(lowered)) < 5:
        raise BadRequest(
            "Password is too repetitive. Mix in more distinct characters.",
            code="weak_password",
            details={"reason": "low_entropy"},
        )
    if email:
        local = email.split("@")[0].lower()
        if len(local) >= 4 and local in lowered:
            raise BadRequest(
                "Password must not contain your email address.",
                code="weak_password",
                details={"reason": "contains_email"},
            )
    if re.fullmatch(r"(.+?)\1{2,}", lowered):
        raise BadRequest(
            "Password is too repetitive. Pick something less predictable.",
            code="weak_password",
            details={"reason": "repeated_pattern"},
        )


# ------------------------------------------------------------------- JWT tokens
def create_access_token(
    *,
    subject: str,
    session_id: str,
    extra_claims: dict[str, Any] | None = None,
    ttl_seconds: int | None = None,
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    ttl = ttl_seconds if ttl_seconds is not None else settings.ACCESS_TOKEN_TTL_SECONDS
    expires_at = now + timedelta(seconds=ttl)
    payload: dict[str, Any] = {
        "sub": subject,
        "sid": session_id,
        "typ": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "iss": _ISSUER,
        "aud": _AUDIENCE,
    }
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(
        payload,
        settings.SECRET_KEY.get_secret_value(),
        algorithm=settings.JWT_ALGORITHM,
    )
    return token, expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            settings.SECRET_KEY.get_secret_value(),
            algorithms=[settings.JWT_ALGORITHM],
            audience=_AUDIENCE,
            issuer=_ISSUER,
            options={"require": ["exp", "iat", "sub", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized(
            "Your session expired. Please sign in again.", code="token_expired"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise Unauthorized("Invalid authentication token.", code="invalid_token") from exc
    if claims.get("typ") != "access":
        raise Unauthorized("Invalid authentication token.", code="invalid_token")
    return claims


def create_signed_token(
    *, subject: str, purpose: str, ttl_seconds: int, extra_claims: dict[str, Any] | None = None
) -> str:
    """Generic signed, purpose-scoped token (broadcast overlays, email links)."""
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "typ": purpose,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
        "iss": _ISSUER,
        "aud": _AUDIENCE,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(
        payload, settings.SECRET_KEY.get_secret_value(), algorithm=settings.JWT_ALGORITHM
    )


def decode_signed_token(token: str, *, purpose: str) -> dict[str, Any]:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            settings.SECRET_KEY.get_secret_value(),
            algorithms=[settings.JWT_ALGORITHM],
            audience=_AUDIENCE,
            issuer=_ISSUER,
        )
    except jwt.InvalidTokenError as exc:
        raise Unauthorized("Invalid or expired link.", code="invalid_token") from exc
    if claims.get("typ") != purpose:
        raise Unauthorized("Invalid or expired link.", code="invalid_token")
    return claims


# --------------------------------------------------------------- opaque secrets
def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_opaque_token(token: str) -> str:
    """SHA-256 of a high-entropy token.

    A password KDF is unnecessary (and too slow) here: the input is 384 bits of
    CSPRNG output, so there is nothing to brute-force.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def new_public_slug_suffix(length: int = 6) -> str:
    """Unambiguous, URL-safe, human-readable id fragment (no 0/O/1/I/l)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def receipt(*parts: str, purpose: str) -> str:
    """Short HMAC tag proving a value came from this server.

    Used for tamper-evident toss results: two captains can check afterwards that
    the flip they were shown is the one the server generated.
    """
    message = "|".join((purpose, *parts)).encode("utf-8")
    digest = hmac.new(
        settings.SECRET_KEY.get_secret_value().encode("utf-8"), message, hashlib.sha256
    ).hexdigest()
    return digest[:32]
