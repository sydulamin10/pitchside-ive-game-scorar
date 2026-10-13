"""Admin-editable, publicly readable site content and tutorial videos.

Covers the WhatsApp contact number, the support FAQ, the display-only currency
conversion rate, and the YouTube tutorials shown on the broadcast page.
"""

from __future__ import annotations

import re
import uuid
from typing import Any
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.errors import BadRequest, NotFound
from app.models.account import SiteContent, TutorialVideo

SITE_KEY = "site"

#: Served to the marketing pages and the user dashboard. Admin edits overlay
#: these defaults key-by-key, so a half-filled form never wipes the FAQ.
DEFAULT_SITE: dict[str, Any] = {
    "whatsapp_number": "",
    "whatsapp_message": "Hi ODCC LIVE, I need help with",
    "exchange_rate_bdt": 110.0,
    "faq": [
        {
            "q": "How do I score a match for free?",
            "a": "Open Matches → New match, add both teams and players, set the toss, and "
            "start scoring ball by ball. Scoring is always free and your public scorecard "
            "link is shareable immediately.",
        },
        {
            "q": "How do I go live on Facebook or YouTube?",
            "a": "A live match uses one credit, or an active Pro / Tournament plan. Open the "
            "match, tap Go Live, connect your destination and start the broadcast.",
        },
        {
            "q": "How do live credits work?",
            "a": "One credit starts one live match. Once a match is live it stays unlocked even if "
            "you leave and come back. Buy credits from the Pricing page or top up your balance.",
        },
        {
            "q": "How do I add balance (top-up)?",
            "a": "On your Account page open Balance → Add Top-up, enter the amount and your "
            "payment reference. An admin confirms it and the balance is added to your wallet.",
        },
        {
            "q": "Can I pay with my balance?",
            "a": "Yes. When buying a Live credit, Pro, or a Tournament package you can pay "
            "from your wallet balance if it has enough funds.",
        },
        {
            "q": "How do I request a coupon?",
            "a": "Open Account → Coupon Request, tell us what you need, and the admin will "
            "review it and issue a code if approved.",
        },
        {
            "q": "How do I manage my teams and players?",
            "a": "Go to Teams to create teams, upload logos, and add players. Each player and team "
            "gets a public profile page.",
        },
        {
            "q": "How do I run a tournament?",
            "a": "Open Tournaments → create one, add teams, generate fixtures and a points table. "
            "The public tournament page updates live as matches finish.",
        },
        {
            "q": "How do I contact support?",
            "a": "Use the ODCC Support Request on your Account page, or message us on WhatsApp "
            "from the Pricing page.",
        },
    ],
}

_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


def extract_youtube_id(raw: str) -> str:
    """Pull the 11-ish char video id out of any common YouTube URL shape."""
    value = (raw or "").strip()
    if not value:
        raise BadRequest("A YouTube link or id is required.", code="tutorial_url_required")
    if _YT_ID_RE.match(value) and "/" not in value and "." not in value:
        return value
    parsed = urlparse(value if "//" in value else f"https://{value}")
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host in ("youtu.be",):
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        if parsed.path.startswith(("/embed/", "/shorts/", "/live/", "/v/")):
            candidate = parsed.path.split("/")[2]
        else:
            candidate = parse_qs(parsed.query).get("v", [""])[0]
    else:
        candidate = ""
    candidate = (candidate or "").strip()
    if not _YT_ID_RE.match(candidate):
        raise BadRequest("That does not look like a YouTube link.", code="tutorial_url_invalid")
    return candidate


# ------------------------------------------------------------------ site content


async def get_site(session: AsyncSession) -> dict[str, Any]:
    row = await session.get(SiteContent, SITE_KEY)
    stored = row.value if row and isinstance(row.value, dict) else {}
    merged = {**DEFAULT_SITE, **stored}
    # Keep the FAQ as a list even if an admin stored an empty object by mistake.
    if not isinstance(merged.get("faq"), list) or not merged["faq"]:
        merged["faq"] = DEFAULT_SITE["faq"]
    return merged


def _clean_faq(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    cleaned: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        question = str(item.get("q") or "").strip()
        answer = str(item.get("a") or "").strip()
        if question and answer:
            cleaned.append({"q": question[:240], "a": answer[:4000]})
    return cleaned


async def save_site(session: AsyncSession, patch: dict[str, Any]) -> dict[str, Any]:
    row = await session.get(SiteContent, SITE_KEY)
    current = dict(row.value) if row and isinstance(row.value, dict) else {}
    for key, value in patch.items():
        if value is None:
            continue
        if key == "faq":
            current[key] = _clean_faq(value)
        else:
            current[key] = value
    if row is None:
        session.add(SiteContent(key=SITE_KEY, value=current))
    else:
        row.value = current
        flag_modified(row, "value")
    await session.flush()
    return await get_site(session)


async def public_site(session: AsyncSession) -> dict[str, Any]:
    site = await get_site(session)
    return {
        "whatsapp_number": site.get("whatsapp_number") or "",
        "whatsapp_link": await whatsapp_link(session),
        "whatsapp_message": site.get("whatsapp_message") or "",
        "exchange_rate_bdt": site.get("exchange_rate_bdt"),
        "faq": site.get("faq") or [],
    }


async def whatsapp_link(session: AsyncSession, prefill: str | None = None) -> str | None:
    site = await get_site(session)
    number = re.sub(r"[^0-9]", "", str(site.get("whatsapp_number") or ""))
    if not number:
        return None
    text = (prefill or site.get("whatsapp_message") or "").strip()
    from urllib.parse import quote

    suffix = f"?text={quote(text)}" if text else ""
    return f"https://wa.me/{number}{suffix}"


# --------------------------------------------------------------- tutorial videos


def tutorial_out(row: TutorialVideo) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "youtube_id": row.youtube_id,
        "url": row.url,
        "embed_url": f"https://www.youtube.com/embed/{row.youtube_id}",
        "thumbnail_url": f"https://img.youtube.com/vi/{row.youtube_id}/hqdefault.jpg",
        "description": row.description,
        "sort_order": row.sort_order,
        "is_active": row.is_active,
        "created_at": row.created_at,
    }


async def list_tutorials(
    session: AsyncSession, *, active_only: bool = False
) -> list[TutorialVideo]:
    stmt = select(TutorialVideo).order_by(
        TutorialVideo.sort_order.asc(), TutorialVideo.created_at.asc()
    )
    if active_only:
        stmt = stmt.where(TutorialVideo.is_active.is_(True))
    return list((await session.execute(stmt)).scalars())


async def create_tutorial(
    session: AsyncSession,
    *,
    title: str,
    url: str,
    description: str | None = None,
    sort_order: int = 0,
    is_active: bool = True,
) -> TutorialVideo:
    youtube_id = extract_youtube_id(url)
    row = TutorialVideo(
        title=title.strip(),
        youtube_id=youtube_id,
        url=url.strip(),
        description=(description or None),
        sort_order=sort_order,
        is_active=is_active,
    )
    session.add(row)
    await session.flush()
    return row


async def update_tutorial(
    session: AsyncSession, tutorial_id: uuid.UUID, patch: dict[str, Any]
) -> TutorialVideo:
    row = await session.get(TutorialVideo, tutorial_id)
    if row is None:
        raise NotFound("That tutorial does not exist.", code="tutorial_not_found")
    if "url" in patch and patch["url"]:
        row.youtube_id = extract_youtube_id(patch["url"])
        row.url = patch["url"].strip()
    for key in ("title", "description", "sort_order", "is_active"):
        if key in patch and patch[key] is not None:
            setattr(row, key, patch[key])
    await session.flush()
    return row


async def delete_tutorial(session: AsyncSession, tutorial_id: uuid.UUID) -> None:
    row = await session.get(TutorialVideo, tutorial_id)
    if row is None:
        raise NotFound("That tutorial does not exist.", code="tutorial_not_found")
    await session.delete(row)
    await session.flush()
