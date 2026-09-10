"""Encrypted site settings, including the Meta app used for Facebook Login."""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.errors import BadRequest
from app.models.setting import AppSetting
from app.services import facebook_live

FACEBOOK_KEY = "facebook"


def _public_facebook(*, app_id: str | None, has_secret: bool) -> dict[str, object]:
    return {
        "configured": facebook_live.configured(),
        "app_id": app_id or None,
        "has_secret": has_secret,
        "redirect_uri": facebook_live.redirect_uri(),
        "scopes": facebook_live.SCOPES,
    }


async def load_facebook_secrets(session: AsyncSession) -> tuple[str | None, str | None]:
    row = await session.get(AppSetting, FACEBOOK_KEY)
    if row is None:
        return None, None
    try:
        data = json.loads(decrypt_secret(row.value_encrypted))
    except (BadRequest, json.JSONDecodeError, TypeError, ValueError):
        return None, None
    if not isinstance(data, dict):
        return None, None
    app_id = str(data.get("app_id") or "").strip() or None
    secret = str(data.get("app_secret") or "").strip() or None
    return app_id, secret


async def hydrate_facebook_runtime(session: AsyncSession) -> None:
    app_id, secret = await load_facebook_secrets(session)
    facebook_live.set_runtime_credentials(app_id, secret)


async def facebook_settings_public(session: AsyncSession) -> dict[str, object]:
    app_id, secret = await load_facebook_secrets(session)
    facebook_live.set_runtime_credentials(app_id, secret)
    return _public_facebook(app_id=app_id, has_secret=bool(secret))


async def save_facebook_settings(
    session: AsyncSession, *, app_id: str, app_secret: str | None
) -> dict[str, object]:
    clean_id = (app_id or "").strip()
    incoming_secret = (app_secret or "").strip()
    existing_id, existing_secret = await load_facebook_secrets(session)
    row = await session.get(AppSetting, FACEBOOK_KEY)

    if not clean_id:
        if row is not None:
            await session.delete(row)
        facebook_live.set_runtime_credentials(None, None)
        await session.flush()
        return _public_facebook(app_id=None, has_secret=False)

    secret = incoming_secret or existing_secret
    if not secret:
        raise BadRequest(
            "Paste the Facebook App Secret once so Connect Facebook can run.",
            code="facebook_secret_required",
        )
    payload = encrypt_secret(json.dumps({"app_id": clean_id, "app_secret": secret}))
    if row is None:
        session.add(AppSetting(key=FACEBOOK_KEY, value_encrypted=payload))
    else:
        row.value_encrypted = payload
    facebook_live.set_runtime_credentials(clean_id, secret)
    await session.flush()
    return _public_facebook(app_id=clean_id, has_secret=True)
