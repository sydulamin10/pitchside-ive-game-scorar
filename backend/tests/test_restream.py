import ssl

from app.services.restream_service import (
    facebook_ingest_host,
    facebook_rtmp_target,
    facebook_tls_context,
    local_rtmp_via_tunnel,
    rtmp_destination,
    _ffmpeg_cmd,
    _sanitize_ffmpeg_line,
)


def test_rtmp_destination_appends_key() -> None:
    assert (
        rtmp_destination("rtmps://live-api-s.facebook.com:443/rtmp/", "abc-key")
        == "rtmps://live-api-s.facebook.com:443/rtmp/abc-key"
    )


def test_rtmp_destination_does_not_double_key() -> None:
    url = "rtmps://a.rtmp.youtube.com/live2/xxxx-yyyy"
    assert rtmp_destination(url, "xxxx-yyyy") == url


def test_rtmp_destination_repairs_query_stuck_on_server() -> None:
    dest = rtmp_destination(
        "rtmps://live-api-s.facebook.com:443/rtmp?s_bl=1&a=AbTEST",
        "1399827385666776",
    )
    assert dest == (
        "rtmps://live-api-s.facebook.com:443/rtmp/1399827385666776"
        "?s_bl=1&a=AbTEST"
    )
    assert "/rtmp?" not in dest


def test_facebook_ingest_uses_local_tls_tunnel_not_port_80() -> None:
    dest = rtmp_destination("rtmps://live-api-s.facebook.com:443/rtmp/", "abc-key")
    assert facebook_ingest_host(dest) == "live-api-s.facebook.com"
    assert local_rtmp_via_tunnel(dest, 19350) == "rtmp://127.0.0.1:19350/rtmp/abc-key"
    assert ":80" not in local_rtmp_via_tunnel(dest, 19350)


def test_facebook_rtmp_target_keeps_query_on_playpath() -> None:
    dest = (
        "rtmps://live-api-s.facebook.com:443/rtmp/1399827385666776"
        "?s_bl=1&s_vt=api-s&a=AbTEST"
    )
    url, opts = facebook_rtmp_target(dest, 19350)
    assert url == "rtmp://127.0.0.1:19350/rtmp"
    assert "?" not in url
    assert opts["rtmp_app"] == "rtmp"
    assert opts["rtmp_playpath"].startswith("1399827385666776?")
    assert "a=AbTEST" in opts["rtmp_playpath"]
    assert opts["rtmp_tcurl"] == "rtmps://live-api-s.facebook.com:443/rtmp"


def test_youtube_is_not_facebook_ingest() -> None:
    url = "rtmps://a.rtmp.youtube.com/live2/xxxx-yyyy"
    assert facebook_ingest_host(url) is None


def test_facebook_tls_context_pins_1_2() -> None:
    ctx = facebook_tls_context()
    assert ctx.minimum_version == ssl.TLSVersion.TLSv1_2
    assert ctx.maximum_version == ssl.TLSVersion.TLSv1_2


def test_ffmpeg_uses_rtmp_playpath_for_facebook() -> None:
    _, opts = facebook_rtmp_target(
        "rtmps://live-api-s.facebook.com:443/rtmp/13998?s_bl=1&a=AbTEST",
        19350,
    )
    cmd = _ffmpeg_cmd("rtsp://odcc-mediamtx:8554/pitchside/abc", "rtmp://127.0.0.1:19350/rtmp", opts)
    assert "-rtmp_playpath" in cmd
    assert "-rtmp_app" in cmd
    assert "copy" in cmd
    assert cmd[-1] == "rtmp://127.0.0.1:19350/rtmp"


def test_ffmpeg_copies_h264_and_transcodes_opus() -> None:
    cmd = _ffmpeg_cmd("rtsp://odcc-mediamtx:8554/pitchside/abc", "rtmp://127.0.0.1:19350/rtmp/key")
    joined = " ".join(cmd)
    assert "-c:v" in cmd and "copy" in cmd
    assert "aac" in cmd
    assert "aresample=async=1" in joined
    assert "libx264" not in cmd
    assert "1280:720" not in joined
    assert "pipe:1" not in joined
    assert "-f" in cmd and "flv" in cmd


def test_ffmpeg_log_redacts_stream_token() -> None:
    line = _sanitize_ffmpeg_line(
        "rtmp://127.0.0.1:9/rtmp?s_bl=1&a=AbSECRET/13998: Input/output error"
    )
    assert "AbSECRET" not in line
    assert "rtmp://<redacted>" in line


def test_start_does_not_cancel_its_own_scheduler() -> None:
    import inspect

    from app.services import restream_service

    assert "_kill_proc" in inspect.getsource(restream_service.start)
    assert "stop(path)" not in inspect.getsource(restream_service.start)
    assert "_ensure_tunnel" in inspect.getsource(restream_service.start)
    assert "facebook_rtmp_target" in inspect.getsource(restream_service.start)
    sched = inspect.getsource(restream_service.schedule)
    assert "proc.wait" in sched
    assert "restream_exited" in sched
