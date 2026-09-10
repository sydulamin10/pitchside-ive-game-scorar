"""Unit tests for media upload URL minting (no database required)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import settings
from app.schemas.media import MediaUploadUrlRequest
from app.services import media_service


def test_local_upload_url_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "MEDIA_BACKEND", "local")
    monkeypatch.setattr(settings, "MEDIA_LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "http://testserver")

    signed = media_service.create_upload_url(
        user_id="user-1",
        payload=MediaUploadUrlRequest(
            kind="team_logo",
            content_type="image/png",
            filename="crest.png",
            content_length=12,
        ),
    )
    assert signed.backend == "local"
    assert signed.method == "PUT"
    assert signed.public_url.startswith("http://testserver/media/")
    assert "/api/v1/media/local/" in signed.upload_url

    token = signed.upload_url.rsplit("/", 1)[-1]
    public = media_service.store_local_upload(
        token=token,
        body=b"\x89PNG\r\n\x1a\nfake",
        content_type="image/png",
    )
    assert public == signed.public_url
    stored = tmp_path / signed.object_key
    assert stored.exists()
    assert stored.read_bytes().startswith(b"\x89PNG")


def test_rejects_non_image_content_type() -> None:
    with pytest.raises(Exception) as exc:
        media_service.create_upload_url(
            user_id="user-1",
            payload=MediaUploadUrlRequest(
                kind="generic",
                content_type="application/pdf",  # type: ignore[arg-type]
            ),
        )
    # Pydantic rejects before the service when typed; if coerced, service BadRequest.
    assert exc.value


def test_expired_token_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "MEDIA_BACKEND", "local")
    monkeypatch.setattr(settings, "MEDIA_LOCAL_DIR", str(tmp_path))
    token = media_service._encode_token("team_logo/u/x.png", "image/png", 1)
    with pytest.raises(Exception) as exc:
        media_service.parse_local_token(token)
    assert "expired" in str(exc.value).lower() or getattr(exc.value, "code", "") == "media_token_expired"


def test_object_key_from_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "https://api.odcc.live")
    key = "generic/u/logo.png"
    assert media_service.object_key_from_public_url(f"https://api.odcc.live/media/{key}") == key
    assert media_service.object_key_from_public_url(f"/media/{key}") == key
    assert media_service.object_key_from_public_url("https://evil.example/media/x.png") is None
    assert media_service.object_key_from_public_url("https://api.odcc.live/media/../secret") is None
