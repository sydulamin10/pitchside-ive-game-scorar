"""Facebook Login + Live Video API: list Pages/Groups, create a live ingest URL.

The phone never sees a stream key. After OAuth we store the user/page tokens on
the stream session (encrypted), list destinations, and on Go live we POST
`/{id}/live_videos` so Facebook hands us a one-shot `secure_stream_url`.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx

from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.errors import BadRequest
from app.core.logging import get_logger
from app.core.security import create_signed_token, decode_signed_token
from app.models.stream import StreamSession

logger = get_logger(__name__)

GRAPH_VERSION = "v21.0"
OAUTH_PURPOSE = "fb_oauth"
SCOPES = "public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,publish_video"

_runtime_app_id: str | None = None
_runtime_app_secret: str | None = None


def set_runtime_credentials(app_id: str | None, app_secret: str | None) -> None:
    """Prefer Admin-saved Meta credentials; fall back to env if these are empty."""
    global _runtime_app_id, _runtime_app_secret
    _runtime_app_id = (app_id or "").strip() or None
    _runtime_app_secret = (app_secret or "").strip() or None


def facebook_app_id() -> str:
    if _runtime_app_id:
        return _runtime_app_id
    return (settings.FACEBOOK_APP_ID or "").strip()


def facebook_app_secret() -> str:
    if _runtime_app_secret:
        return _runtime_app_secret
    if settings.FACEBOOK_APP_SECRET:
        return settings.FACEBOOK_APP_SECRET.get_secret_value().strip()
    return ""


def configured() -> bool:
    return bool(facebook_app_id() and facebook_app_secret())


def redirect_uri() -> str:
    """Must match Valid OAuth Redirect URIs on the Meta app (website host, not api.*)."""
    return f"{settings.PUBLIC_WEB_URL.rstrip('/')}/api/v1/public/social/facebook/callback"


def split_secure_stream_url(url: str) -> tuple[str, str]:
    """Split Facebook's RTMPS ingest into server + key.

    Graph returns ``rtmps://host:443/rtmp/{id}?s_bl=1&a=...``. The query belongs
    on the stream key. Putting it on the server URL made ffmpeg publish
    ``/rtmp?a=token/id`` and Facebook dropped the connection.
    """
    raw = (url or "").strip()
    if not raw:
        raise BadRequest("Facebook did not return a stream URL.", code="facebook_no_stream_url")
    parsed = urlparse(raw)
    path = (parsed.path or "").rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    if "/" not in path.lstrip("/"):
        key = path.lstrip("/")
        base = f"{parsed.scheme}://{parsed.netloc}"
        if not key:
            raise BadRequest("Facebook stream URL was incomplete.", code="facebook_bad_stream_url")
        return base, f"{key}{query}"
    server_path, key = path.rsplit("/", 1)
    base = f"{parsed.scheme}://{parsed.netloc}{server_path}"
    if not key:
        raise BadRequest("Facebook stream URL was incomplete.", code="facebook_bad_stream_url")
    return base, f"{key}{query}"


def load_social(row: StreamSession) -> dict[str, Any]:
    if not row.social_auth_encrypted:
        return {}
    try:
        return json.loads(decrypt_secret(row.social_auth_encrypted))
    except (BadRequest, json.JSONDecodeError, TypeError):
        return {}


def save_social(row: StreamSession, payload: dict[str, Any]) -> None:
    row.social_auth_encrypted = encrypt_secret(json.dumps(payload))


def public_facebook_status(row: StreamSession) -> dict[str, Any]:
    fb = load_social(row).get("facebook") or {}
    selected = fb.get("selected") or None
    pages = [{"kind": "facebook_page", "id": p["id"], "name": p["name"]} for p in fb.get("pages") or [] if p.get("id")]
    groups = [
        {"kind": "facebook_group", "id": g["id"], "name": g["name"]}
        for g in fb.get("groups") or []
        if g.get("id")
    ]
    profile = None
    if fb.get("user_id") and fb.get("name"):
        profile = {"kind": "facebook_profile", "id": fb["user_id"], "name": fb["name"]}
    return {
        "enabled": configured(),
        "connected": bool(fb.get("access_token")),
        "name": fb.get("name"),
        "pages": pages,
        "groups": groups,
        "profile": profile,
        "selected": selected,
        "groups_error": fb.get("groups_error"),
        "ingest_ready": bool(fb.get("live_video_id")),
    }


def ingest_ready(row: StreamSession) -> bool:
    fb = load_social(row).get("facebook") or {}
    return bool(fb.get("live_video_id") and row.rtmp_url and row.stream_key_encrypted)


def mint_oauth_state(*, match_id: str, slug: str, camera_token: str | None, return_to: str) -> str:
    return create_signed_token(
        subject=match_id,
        purpose=OAUTH_PURPOSE,
        ttl_seconds=600,
        extra_claims={"slug": slug, "cam": camera_token or "", "next": return_to},
    )


def read_oauth_state(state: str) -> dict[str, Any]:
    return decode_signed_token(state, purpose=OAUTH_PURPOSE)


def authorization_url(state: str) -> str:
    if not configured():
        raise BadRequest(
            "Facebook Login is not configured on this server yet.",
            code="facebook_not_configured",
        )
    query = urlencode(
        {
            "client_id": facebook_app_id(),
            "redirect_uri": redirect_uri(),
            "state": state,
            "response_type": "code",
            "scope": SCOPES,
            # Ask again for Pages if the last login skipped the page picker.
            "auth_type": "rerequest",
            "return_scopes": "true",
            "display": "touch",
        }
    )
    return f"https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth?{query}"


async def _graph(method: str, path: str, *, token: str | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = path if path.startswith("http") else f"https://graph.facebook.com/{GRAPH_VERSION}/{path.lstrip('/')}"
    query = dict(params or {})
    if token:
        query["access_token"] = token
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.request(method, url, params=query)
    try:
        payload = response.json()
    except ValueError as exc:
        raise BadRequest("Facebook returned a non-JSON response.", code="facebook_bad_response") from exc
    if response.status_code >= 400 or (isinstance(payload, dict) and payload.get("error")):
        err = payload.get("error") if isinstance(payload, dict) else None
        message = "Facebook request failed."
        if isinstance(err, dict):
            message = str(err.get("message") or message)
        logger.warning(
            "facebook_graph_error",
            extra={
                "status": response.status_code,
                "path": path,
                "fb_code": err.get("code") if isinstance(err, dict) else None,
                "fb_subcode": err.get("error_subcode") if isinstance(err, dict) else None,
                "fb_message": message[:240],
            },
        )
        lowered = message.lower()
        if "desktop app" in lowered:
            raise BadRequest(
                "This Meta app is Desktop, not Website. developers.facebook.com → Settings → "
                "Advanced → Native or desktop app = No. Add Website https://odcc.live then Connect Facebook again.",
                code="facebook_desktop_app",
            ) from None
        if "pages_manage_posts" in lowered or "pages_read_engagement" in lowered:
            raise BadRequest(
                "Facebook will not start a Page live until this Meta app has "
                "pages_read_engagement and pages_manage_posts. Add both under "
                "ODCC Live → Use cases → Facebook Login, then tap Reconnect Facebook "
                "and tick the Page. Timeline live does not need those Page permissions.",
                code="facebook_page_live_permission",
            ) from None
        raise BadRequest(message, code="facebook_api_error")
    if not isinstance(payload, dict):
        raise BadRequest("Facebook returned an unexpected payload.", code="facebook_bad_response")
    return payload


async def exchange_code(code: str) -> dict[str, Any]:
    if not configured():
        raise BadRequest("Facebook Login is not configured.", code="facebook_not_configured")
    secret = facebook_app_secret()
    short = await _graph(
        "GET",
        "oauth/access_token",
        params={
            "client_id": facebook_app_id(),
            "client_secret": secret,
            "redirect_uri": redirect_uri(),
            "code": code,
        },
    )
    token = str(short.get("access_token") or "")
    if not token:
        raise BadRequest("Facebook did not return an access token.", code="facebook_no_token")
    try:
        long_lived = await _graph(
            "GET",
            "oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": facebook_app_id(),
                "client_secret": secret,
                "fb_exchange_token": token,
            },
        )
        token = str(long_lived.get("access_token") or token)
    except BadRequest:
        logger.info("facebook_long_lived_token_skipped")
    me = await _graph("GET", "me", token=token, params={"fields": "id,name"})
    pages: list[dict[str, str]] = []
    try:
        accounts = await _graph(
            "GET",
            "me/accounts",
            token=token,
            params={"fields": "id,name,access_token", "limit": 100},
        )
        for item in accounts.get("data") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            pages.append(
                {
                    "id": str(item["id"]),
                    "name": str(item.get("name") or "Page"),
                    "access_token": str(item.get("access_token") or token),
                }
            )
    except BadRequest as exc:
        logger.warning("facebook_pages_failed", extra={"error": str(exc)})

    groups: list[dict[str, str]] = []
    groups_error: str | None = None
    try:
        listed = await _graph(
            "GET",
            "me/groups",
            token=token,
            params={"fields": "id,name,administrator", "limit": 100},
        )
        for item in listed.get("data") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            groups.append({"id": str(item["id"]), "name": str(item.get("name") or "Group")})
    except BadRequest as exc:
        groups_error = str(exc)

    return {
        "user_id": str(me.get("id") or ""),
        "name": str(me.get("name") or "Facebook"),
        "access_token": token,
        "pages": pages,
        "groups": groups,
        "groups_error": groups_error,
        "selected": None,
        "live_video_id": None,
        "live_token": None,
    }


def disconnect(row: StreamSession) -> None:
    data = load_social(row)
    data.pop("facebook", None)
    if data:
        save_social(row, data)
    else:
        row.social_auth_encrypted = None


def select_destination(row: StreamSession, *, kind: str, dest_id: str | None) -> dict[str, Any]:
    data = load_social(row)
    fb = data.get("facebook")
    if not isinstance(fb, dict) or not fb.get("access_token"):
        raise BadRequest("Connect Facebook first, then pick a Page or Group.", code="facebook_not_connected")

    selected: dict[str, str]
    if kind == "facebook_page":
        page = next((p for p in fb.get("pages") or [] if p.get("id") == dest_id), None)
        if not page:
            raise BadRequest("That Facebook Page is not in your connected list.", code="facebook_page_missing")
        selected = {"kind": kind, "id": page["id"], "name": page["name"]}
    elif kind == "facebook_group":
        group = next((g for g in fb.get("groups") or [] if g.get("id") == dest_id), None)
        if not group:
            raise BadRequest("That Facebook Group is not in your connected list.", code="facebook_group_missing")
        selected = {"kind": kind, "id": group["id"], "name": group["name"]}
    elif kind == "facebook_profile":
        if not fb.get("user_id"):
            raise BadRequest("Facebook profile is not available on this login.", code="facebook_profile_missing")
        selected = {"kind": kind, "id": str(fb["user_id"]), "name": str(fb.get("name") or "Profile")}
    else:
        raise BadRequest("Pick a Facebook Page, Group or profile.", code="facebook_bad_kind")

    fb["selected"] = selected
    data["facebook"] = fb
    save_social(row, data)
    row.destination_label = f"{selected['kind'].replace('_', ' ')}: {selected['name']}"[:120]
    return selected


def _token_for_target(fb: dict[str, Any], kind: str, dest_id: str) -> str:
    if kind == "facebook_page":
        page = next((p for p in fb.get("pages") or [] if p.get("id") == dest_id), None)
        if page and page.get("access_token"):
            return str(page["access_token"])
    token = str(fb.get("access_token") or "")
    if not token:
        raise BadRequest("Facebook login expired. Connect Facebook again.", code="facebook_not_connected")
    return token


async def create_live(*, target_id: str, token: str, title: str, description: str | None = None) -> dict[str, str]:
    # LIVE_NOW at create: Graph rejects a later status=LIVE_NOW update (error
    # 100), so an UNPUBLISHED live never appears on the Page. ffmpeg must start
    # ingest within a few seconds or Facebook expires the broadcast.
    params: dict[str, Any] = {"status": "LIVE_NOW", "title": title[:255]}
    if description:
        params["description"] = description[:1000]
    payload = await _graph("POST", f"{target_id}/live_videos", token=token, params=params)
    live_id = str(payload.get("id") or "")
    ingest = str(payload.get("secure_stream_url") or payload.get("stream_url") or "")
    if not live_id or not ingest:
        raise BadRequest("Facebook created a live but did not return ingest details.", code="facebook_no_stream_url")
    return {"id": live_id, "secure_stream_url": ingest}


async def set_live_now(live_id: str, token: str) -> None:
    try:
        await _graph("POST", live_id, token=token, params={"status": "LIVE_NOW"})
    except BadRequest as exc:
        logger.warning(
            "facebook_set_live_now_skipped",
            extra={"live_id": live_id, "error": str(exc)[:200]},
        )
        return
    try:
        status = await _graph(
            "GET",
            live_id,
            token=token,
            params={"fields": "live_status,status"},
        )
    except BadRequest:
        status = {}
    logger.warning(
        "facebook_live_published",
        extra={
            "live_id": live_id,
            "live_status": status.get("live_status") or status.get("status"),
        },
    )


async def end_live(live_id: str, token: str) -> None:
    try:
        await _graph("POST", live_id, token=token, params={"end_live_video": "true"})
    except BadRequest:
        logger.warning("facebook_end_live_failed", extra={"live_id": live_id})


async def prepare_ingest(row: StreamSession, *, title: str) -> bool:
    """Create a Facebook live on the selected destination. Returns True if ingest was set."""
    data = load_social(row)
    fb = data.get("facebook")
    if not isinstance(fb, dict):
        return False
    selected = fb.get("selected")
    if not isinstance(selected, dict) or not selected.get("id"):
        return False
    kind = str(selected.get("kind") or "")
    dest_id = str(selected["id"])
    token = _token_for_target(fb, kind, dest_id)
    prev_id = fb.get("live_video_id")
    prev_token = fb.get("live_token") or token
    if prev_id and prev_token:
        await end_live(str(prev_id), str(prev_token))
    live = await create_live(target_id=dest_id, token=token, title=title)
    base, key = split_secure_stream_url(live["secure_stream_url"])
    row.rtmp_url = base
    row.stream_key_encrypted = encrypt_secret(key)
    fb["live_video_id"] = live["id"]
    fb["live_token"] = token
    data["facebook"] = fb
    save_social(row, data)
    return True


async def finish_ingest(row: StreamSession) -> None:
    data = load_social(row)
    fb = data.get("facebook")
    if not isinstance(fb, dict):
        return
    live_id = fb.get("live_video_id")
    token = fb.get("live_token") or fb.get("access_token")
    if live_id and token:
        await end_live(str(live_id), str(token))
    fb["live_video_id"] = None
    fb["live_token"] = None
    data["facebook"] = fb
    save_social(row, data)
