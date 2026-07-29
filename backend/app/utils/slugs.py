"""Public URL slugs.

Shared match links get pasted into WhatsApp groups and read aloud, so they need
to be short, unguessable enough that nobody stumbles onto a private match, and
free of characters that are easy to confuse.
"""

from __future__ import annotations

from slugify import slugify

from app.core.security import new_public_slug_suffix

MAX_BASE_LENGTH = 48
RESERVED_SLUGS = frozenset(
    {
        "about",
        "admin",
        "api",
        "blog",
        "broadcast",
        "changelog",
        "dashboard",
        "download",
        "features",
        "guides",
        "login",
        "logout",
        "new",
        "overlay",
        "privacy",
        "register",
        "s",
        "score",
        "settings",
        "t",
        "terms",
        "tools",
        "tournament",
    }
)


def slug_base(*parts: str | None) -> str:
    """Readable prefix built from the supplied names."""
    text = " ".join(part for part in parts if part)
    base = slugify(text, max_length=MAX_BASE_LENGTH, word_boundary=True, save_order=True)
    return base or "match"


def build_public_slug(*parts: str | None, suffix_length: int = 6) -> str:
    """``mumbai-strikers-vs-city-xi-k4m2pq``.

    The random suffix is what makes the link unguessable; the readable prefix is
    what makes it shareable. Never derive a slug from the primary key.
    """
    base = slug_base(*parts)
    if base in RESERVED_SLUGS:
        base = f"{base}-match"
    return f"{base}-{new_public_slug_suffix(suffix_length)}"
