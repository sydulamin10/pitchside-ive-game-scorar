"""Email verification tokens and the login gate."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.core.errors import Forbidden, Unauthorized
from app.core.security import create_signed_token, decode_signed_token
from app.services import auth_service


def test_email_verify_token_roundtrip() -> None:
    user_id = str(uuid.uuid4())
    token = create_signed_token(subject=user_id, purpose="email_verify", ttl_seconds=60)
    claims = decode_signed_token(token, purpose="email_verify")
    assert claims["sub"] == user_id
    assert claims["typ"] == "email_verify"


def test_email_verify_token_rejects_other_purpose() -> None:
    token = create_signed_token(subject=str(uuid.uuid4()), purpose="email_verify", ttl_seconds=60)
    with pytest.raises(Unauthorized):
        decode_signed_token(token, purpose="overlay")


def test_verify_url_encodes_token() -> None:
    url = settings.public_verify_email_url("a+b/c=")
    assert "token=" in url
    assert "a+b/c=" not in url.split("token=", 1)[1]
    assert url.startswith(settings.PUBLIC_WEB_URL.rstrip("/"))


@pytest.mark.asyncio
async def test_unverified_login_is_blocked(monkeypatch) -> None:
    monkeypatch.setattr(settings, "EMAIL_VERIFY_REQUIRED", True)
    user = SimpleNamespace(
        is_active=True,
        is_approved=True,
        is_admin=False,
        is_email_verified=False,
        password_hash="unused",
        locked_until=None,
        failed_login_count=0,
    )

    async def _fake_execute(_stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: user)

    session = SimpleNamespace(execute=_fake_execute, commit=lambda: None)
    monkeypatch.setattr(auth_service, "verify_password", lambda *_args, **_kwargs: True)

    with pytest.raises(Forbidden) as caught:
        await auth_service.authenticate(session, email="scorer@example.org", password="password1234")
    assert caught.value.code == "email_not_verified"
