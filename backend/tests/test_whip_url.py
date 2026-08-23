"""Production must not hand phones a localhost WHIP URL."""

from __future__ import annotations

from app.services import stream_session_service as svc


def test_loopback_whip_is_hidden_in_production(monkeypatch) -> None:
    class _Settings:
        is_production = True
        MEDIAMTX_WHIP_BASE_URL = "http://localhost:8889"

    monkeypatch.setattr(svc, "settings", _Settings())
    assert svc.whip_publish_url("pitchside/abc123") is None


def test_public_whip_is_kept_in_production(monkeypatch) -> None:
    class _Settings:
        is_production = True
        MEDIAMTX_WHIP_BASE_URL = "https://stream.example.com:8889"

    monkeypatch.setattr(svc, "settings", _Settings())
    assert (
        svc.whip_publish_url("pitchside/abc123")
        == "https://stream.example.com:8889/pitchside/abc123/whip"
    )


def test_local_dev_still_gets_localhost_whip(monkeypatch) -> None:
    class _Settings:
        is_production = False
        MEDIAMTX_WHIP_BASE_URL = "http://localhost:8889"

    monkeypatch.setattr(svc, "settings", _Settings())
    assert svc.whip_publish_url("pitchside/abc123") == "http://localhost:8889/pitchside/abc123/whip"
