import pytest
from app.services.facebook_live import public_facebook_status, split_secure_stream_url
from app.services.restream_service import rtmp_destination


def test_split_facebook_secure_stream_url() -> None:
    base, key = split_secure_stream_url("rtmps://live-api-s.facebook.com:443/rtmp/abc-key")
    assert base == "rtmps://live-api-s.facebook.com:443/rtmp"
    assert key == "abc-key"
    assert rtmp_destination(base, key) == "rtmps://live-api-s.facebook.com:443/rtmp/abc-key"


def test_split_facebook_host_key_only() -> None:
    base, key = split_secure_stream_url("rtmps://rtmp-api.facebook.com/streamkey")
    assert base == "rtmps://rtmp-api.facebook.com"
    assert key == "streamkey"


def test_split_facebook_query_stays_on_key() -> None:
    url = (
        "rtmps://live-api-s.facebook.com:443/rtmp/1399827385666776"
        "?s_bl=1&s_ow=10&s_psm=1&s_pub=1&s_sw=0&s_tids=1&s_vt=api-s&a=AbTEST"
    )
    base, key = split_secure_stream_url(url)
    assert base == "rtmps://live-api-s.facebook.com:443/rtmp"
    assert key == "1399827385666776?s_bl=1&s_ow=10&s_psm=1&s_pub=1&s_sw=0&s_tids=1&s_vt=api-s&a=AbTEST"
    dest = rtmp_destination(base, key)
    assert dest == url
    assert "/rtmp?" not in dest


def test_public_facebook_status_strips_tokens() -> None:
    import json

    from app.core.crypto import encrypt_secret
    from app.models.stream import StreamSession
    from app.services.facebook_live import public_facebook_status

    row = StreamSession()
    row.social_auth_encrypted = encrypt_secret(
        json.dumps(
            {
                "facebook": {
                    "user_id": "1",
                    "name": "Rahim",
                    "access_token": "USER_SECRET",
                    "pages": [{"id": "9", "name": "ODCC", "access_token": "PAGE_SECRET"}],
                    "groups": [{"id": "g1", "name": "Club"}],
                    "selected": {"kind": "facebook_page", "id": "9", "name": "ODCC"},
                }
            }
        )
    )
    status = public_facebook_status(row)
    dumped = json.dumps(status)
    assert "USER_SECRET" not in dumped
    assert "PAGE_SECRET" not in dumped
    assert status["connected"] is True
    assert status["ingest_ready"] is False
    assert status["pages"][0]["name"] == "ODCC"
    assert status["groups"][0]["id"] == "g1"


def test_runtime_credentials_enable_oauth_url(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.errors import BadRequest
    from app.services import facebook_live

    monkeypatch.setattr(facebook_live.settings, "FACEBOOK_APP_ID", None)
    monkeypatch.setattr(facebook_live.settings, "FACEBOOK_APP_SECRET", None)
    facebook_live.set_runtime_credentials(None, None)
    try:
        facebook_live.authorization_url("state")
        raise AssertionError("expected facebook_not_configured")
    except BadRequest as exc:
        assert exc.code == "facebook_not_configured"

    facebook_live.set_runtime_credentials("1234567890", "app-secret")
    try:
        assert facebook_live.configured() is True
        url = facebook_live.authorization_url("csrf-state")
        assert "client_id=1234567890" in url
        assert "auth_type=rerequest" in url
        assert facebook_live.redirect_uri().endswith("/api/v1/public/social/facebook/callback")
        assert "pages_show_list" in url
        assert "publish_video" in url
        assert "pages_manage_posts" in url
        assert "display=touch" in url
    finally:
        facebook_live.set_runtime_credentials(None, None)


def test_disconnect_clears_facebook_tokens() -> None:
    import json

    from app.core.crypto import encrypt_secret
    from app.models.stream import StreamSession
    from app.services.facebook_live import disconnect, public_facebook_status

    row = StreamSession()
    row.social_auth_encrypted = encrypt_secret(
        json.dumps({"facebook": {"access_token": "USER_SECRET", "name": "Rahim", "user_id": "1"}})
    )
    disconnect(row)
    status = public_facebook_status(row)
    assert status["connected"] is False
    assert row.social_auth_encrypted is None


def test_desktop_app_oauth_error_is_explained() -> None:
    import inspect

    from app.services.facebook_live import _graph

    src = inspect.getsource(_graph)
    assert "facebook_desktop_app" in src
    assert "desktop app" in src


def test_create_live_starts_as_live_now() -> None:
    import inspect

    from app.services.facebook_live import create_live

    src = inspect.getsource(create_live)
    assert '"LIVE_NOW"' in src
    assert '"UNPUBLISHED"' not in src


def test_restream_helper_is_defined() -> None:
    from app.services import facebook_live, stream_session_service

    assert callable(stream_session_service._restream)
    assert callable(facebook_live.set_live_now)
