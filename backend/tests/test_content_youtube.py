from app.services.content_service import extract_youtube_id, extract_youtube_playlist_id


def test_extract_youtube_watch_url() -> None:
    assert extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9wgGcQ") == "dQw4w9wgGcQ"


def test_extract_youtube_short_url() -> None:
    assert extract_youtube_id("https://youtu.be/dQw4w9wgGcQ") == "dQw4w9wgGcQ"


def test_extract_playlist_from_playlist_url() -> None:
    url = "https://www.youtube.com/playlist?list=PLabcdefghijklmnopqrstuv"
    assert extract_youtube_playlist_id(url) == "PLabcdefghijklmnopqrstuv"


def test_extract_playlist_from_watch_url() -> None:
    url = "https://www.youtube.com/watch?v=dQw4w9wgGcQ&list=PLabcdefghijklmnopqrstuv"
    assert extract_youtube_playlist_id(url) == "PLabcdefghijklmnopqrstuv"


def test_empty_playlist_is_none() -> None:
    assert extract_youtube_playlist_id("") is None
    assert extract_youtube_playlist_id("https://example.com") is None
