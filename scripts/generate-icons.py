"""Resize branding/odcc-live.png into PWA icons.

White corners around the rounded mark are flood-filled with the navy
background so home-screen icons do not show a paper fringe.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "public" / "branding" / "odcc-live.png"
ICON_DIR = ROOT / "frontend" / "public" / "icons"
BRAND_DIR = ROOT / "frontend" / "public" / "branding"

NAVY = (0, 15, 41, 255)
CLEAR = (0, 0, 0, 0)
PAPER = 210


def is_paper(px: tuple[int, ...]) -> bool:
    return px[0] > PAPER and px[1] > PAPER and px[2] > PAPER


def flood_paper_corners(im: Image.Image, fill: tuple[int, int, int, int]) -> Image.Image:
    rgba = im.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    seen: set[tuple[int, int]] = set()
    q: deque[tuple[int, int]] = deque()
    for start in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if is_paper(pixels[start]):
            q.append(start)
            seen.add(start)
    while q:
        x, y = q.popleft()
        pixels[x, y] = fill
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if (nx, ny) in seen:
                continue
            if not is_paper(pixels[nx, ny]):
                continue
            seen.add((nx, ny))
            q.append((nx, ny))
    return rgba


def save_icon(src: Image.Image, size: int, dest: Path, pad: int = 0) -> None:
    canvas = Image.new("RGBA", (size, size), NAVY)
    inner = size - 2 * pad
    resized = src.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.paste(resized, (pad, pad), resized)
    canvas.convert("RGB").save(dest, "PNG", optimize=True)
    print(f"{dest.name:28} {size}px  {dest.stat().st_size / 1024:.1f} kB")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source logo: {SRC}")
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    original = Image.open(SRC)
    ui = flood_paper_corners(original, CLEAR)
    ui.save(SRC, "PNG", optimize=True)
    icons = flood_paper_corners(original, NAVY)
    save_icon(icons, 192, ICON_DIR / "icon-192.png")
    save_icon(icons, 512, ICON_DIR / "icon-512.png")
    save_icon(icons, 512, ICON_DIR / "icon-maskable-512.png", pad=48)
    save_icon(icons, 180, ICON_DIR / "apple-touch-icon.png")
    save_icon(icons, 32, BRAND_DIR / "odcc-live-favicon.png")


if __name__ == "__main__":
    main()
