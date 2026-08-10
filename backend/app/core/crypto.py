"""Symmetric encryption helpers (stream keys, etc.)."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.errors import BadRequest


def _fernet() -> Fernet:
    # Derive a stable 32-byte Fernet key from SECRET_KEY without storing a second secret.
    digest = hashlib.sha256(settings.SECRET_KEY.get_secret_value().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise BadRequest("Stored secret could not be decrypted.", code="decrypt_failed") from exc
