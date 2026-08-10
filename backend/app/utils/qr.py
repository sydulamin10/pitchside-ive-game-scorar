"""QR code helpers (PNG preferred for reliable <img> display)."""

from __future__ import annotations

from io import BytesIO


def qr_png_bytes(url: str, *, scale: int = 6, border: int = 2) -> bytes:
    """Return a PNG QR encoding ``url``. Requires ``segno``."""
    import segno

    qr = segno.make(url, error="m")
    buffer = BytesIO()
    qr.save(buffer, kind="png", scale=scale, border=border)
    return buffer.getvalue()


def profile_qr_svg(url: str, *, scale: int = 4) -> str:
    """Return an SVG document encoding ``url`` as a QR code."""
    try:
        import segno

        qr = segno.make(url, error="m")
        buffer = BytesIO()
        qr.save(buffer, kind="svg", scale=scale, border=2)
        return buffer.getvalue().decode("utf-8")
    except ImportError:
        return _fallback_svg(url)


def qr_svg_bytes(url: str, *, scale: int = 4) -> bytes:
    """Binary SVG for FastAPI ``Response(content=...)``."""
    return profile_qr_svg(url, scale=scale).encode("utf-8")


def _fallback_svg(url: str) -> str:
    """Tiny placeholder SVG when segno is unavailable (dev-only fallback)."""
    safe = (
        url.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">'
        '<rect width="200" height="200" fill="#fff"/>'
        '<rect x="16" y="16" width="48" height="48" fill="#000"/>'
        '<rect x="136" y="16" width="48" height="48" fill="#000"/>'
        '<rect x="16" y="136" width="48" height="48" fill="#000"/>'
        f'<text x="100" y="110" text-anchor="middle" font-size="8" fill="#333">{safe[:40]}</text>'
        "</svg>"
    )
