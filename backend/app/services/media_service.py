"""Signed media uploads (Cloudflare R2) with a local development fallback.

Callers ask for an upload URL, PUT the bytes there, then store the returned
``public_url`` on the team/player row. The API never buffers large images on
the hot scoring path.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from app.core.config import settings
from app.core.errors import BadRequest, Forbidden, ServiceUnavailable
from app.schemas.media import MediaUploadUrlRequest, MediaUploadUrlResponse

_SAFE_NAME = re.compile(r"[^a-zA-Z0-9._-]+")
_ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _b64(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def _unb64(value: str) -> str:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + pad).encode()).decode()


def local_media_root() -> Path:
    root = Path(settings.MEDIA_LOCAL_DIR)
    if not root.is_absolute():
        root = Path(__file__).resolve().parents[2] / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def create_upload_url(
    *, user_id: str, payload: MediaUploadUrlRequest
) -> MediaUploadUrlResponse:
    content_type = payload.content_type.lower()
    if content_type not in _ALLOWED_TYPES:
        raise BadRequest("Only JPEG, PNG, WebP, or GIF images are accepted.", code="media_type")
    if payload.content_length is not None and payload.content_length > settings.MEDIA_MAX_BYTES:
        raise BadRequest(
            f"File is too large (max {settings.MEDIA_MAX_BYTES} bytes).",
            code="media_too_large",
        )

    extension = _ALLOWED_TYPES[content_type]
    raw_name = payload.filename or f"{payload.kind}{extension}"
    stem = _SAFE_NAME.sub("-", Path(raw_name).stem)[:60] or payload.kind
    object_key = (
        f"{payload.kind}/{user_id}/{int(time.time())}-{secrets.token_hex(4)}-{stem}{extension}"
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.MEDIA_UPLOAD_TTL_SECONDS)

    if settings.MEDIA_BACKEND == "r2":
        return _r2_upload_url(object_key, content_type, expires_at)
    return _local_upload_url(object_key, content_type, expires_at)


def _public_url_for(object_key: str) -> str:
    return f"{settings.media_public_base}/{quote(object_key, safe='/')}"


def _sign(object_key: str, content_type: str, expires: int) -> str:
    payload = f"{object_key}|{content_type}|{expires}"
    return hmac.new(
        settings.SECRET_KEY.get_secret_value().encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()


def _encode_token(object_key: str, content_type: str, expires: int) -> str:
    digest = _sign(object_key, content_type, expires)
    # Base64url segments so dots in filenames cannot break the token shape.
    return f"{expires}.{_b64(object_key)}.{_b64(content_type)}.{digest}"


def parse_local_token(token: str) -> tuple[str, str]:
    try:
        expires_s, encoded_key, encoded_type, digest = token.split(".", 3)
        expires = int(expires_s)
        object_key = _unb64(encoded_key)
        content_type = _unb64(encoded_type).lower()
    except (ValueError, UnicodeDecodeError) as exc:
        raise Forbidden("Upload link is invalid.", code="media_token_invalid") from exc
    if expires < int(time.time()):
        raise Forbidden("Upload link has expired.", code="media_token_expired")

    expected = _sign(object_key, content_type, expires)
    if not hmac.compare_digest(expected, digest):
        raise Forbidden("Upload link is invalid.", code="media_token_invalid")
    if content_type not in _ALLOWED_TYPES:
        raise Forbidden("Upload link is invalid.", code="media_token_invalid")
    if ".." in object_key or object_key.startswith(("/", "\\")):
        raise Forbidden("Upload link is invalid.", code="media_token_invalid")
    return object_key, content_type


def _local_upload_url(
    object_key: str, content_type: str, expires_at: datetime
) -> MediaUploadUrlResponse:
    token = _encode_token(object_key, content_type, int(expires_at.timestamp()))
    upload_url = f"{settings.PUBLIC_API_URL.rstrip('/')}/api/v1/media/local/{token}"
    return MediaUploadUrlResponse(
        upload_url=upload_url,
        public_url=_public_url_for(object_key),
        method="PUT",
        headers={"Content-Type": content_type},
        object_key=object_key,
        expires_at=expires_at,
        backend="local",
    )


def store_local_upload(*, token: str, body: bytes, content_type: str | None) -> str:
    object_key, expected_type = parse_local_token(token)
    incoming = (content_type or expected_type).split(";")[0].strip().lower()
    if incoming and incoming != expected_type:
        raise BadRequest("Content-Type does not match the signed upload.", code="media_type")
    if len(body) > settings.MEDIA_MAX_BYTES:
        raise BadRequest(
            f"File is too large (max {settings.MEDIA_MAX_BYTES} bytes).",
            code="media_too_large",
        )
    if not body:
        raise BadRequest("Empty upload.", code="media_empty")

    dest = local_media_root() / object_key
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    return _public_url_for(object_key)


def _r2_upload_url(
    object_key: str, content_type: str, expires_at: datetime
) -> MediaUploadUrlResponse:
    if not all(
        [
            settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY,
            settings.R2_BUCKET,
            settings.R2_PUBLIC_BASE_URL or settings.MEDIA_PUBLIC_BASE_URL,
        ]
    ):
        raise ServiceUnavailable(
            "Object storage is not configured.",
            code="media_not_configured",
        )
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise ServiceUnavailable(
            "boto3 is required for R2 uploads. Install boto3 or set MEDIA_BACKEND=local.",
            code="media_dependency_missing",
        ) from exc

    endpoint = settings.R2_ENDPOINT_URL
    if not endpoint and settings.R2_ACCOUNT_ID:
        endpoint = f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    secret = (
        settings.R2_SECRET_ACCESS_KEY.get_secret_value() if settings.R2_SECRET_ACCESS_KEY else None
    )
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )
    ttl = max(60, int((expires_at - datetime.now(UTC)).total_seconds()))
    upload_url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.R2_BUCKET,
            "Key": object_key,
            "ContentType": content_type,
        },
        ExpiresIn=ttl,
    )
    return MediaUploadUrlResponse(
        upload_url=upload_url,
        public_url=_public_url_for(object_key),
        method="PUT",
        headers={"Content-Type": content_type},
        object_key=object_key,
        expires_at=expires_at,
        backend="r2",
    )
