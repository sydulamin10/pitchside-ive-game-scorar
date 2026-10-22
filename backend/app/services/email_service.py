"""Outbound mail. Gmail SMTP is the production transport.

The App Password lives only in the process environment. Nothing here logs
recipients together with tokens, and a missing SMTP config must not take
registration down — the API still creates the account and the user can retry.
"""

from __future__ import annotations

import asyncio
import html
import smtplib
from email.message import EmailMessage

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _from_header() -> str:
    address = (settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME or "").strip()
    name = settings.SMTP_FROM_NAME.strip() or "ODCC LIVE"
    return f"{name} <{address}>" if address else name


def _send_message(to_email: str, subject: str, text: str, html: str) -> None:
    if not settings.smtp_configured:
        logger.warning("smtp_not_configured")
        raise RuntimeError("smtp_not_configured")
    password = settings.SMTP_PASSWORD.get_secret_value() if settings.SMTP_PASSWORD else ""
    message = EmailMessage()
    message["From"] = _from_header()
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as client:
        client.ehlo()
        if settings.SMTP_STARTTLS:
            client.starttls()
            client.ehlo()
        client.login((settings.SMTP_USERNAME or "").strip(), password)
        client.send_message(message)


async def send_verification_email(*, to_email: str, display_name: str, verify_url: str) -> bool:
    subject = "Confirm your ODCC LIVE account"
    greeting = display_name.strip() or "there"
    safe_name = html.escape(greeting)
    safe_url = html.escape(verify_url, quote=True)
    text = (
        f"Hi {greeting},\n\n"
        "Confirm this email address to finish creating your ODCC LIVE account.\n\n"
        f"{verify_url}\n\n"
        "This link expires in 24 hours. If you did not create an account, ignore this email.\n"
    )
    html_body = f"""
<p>Hi {safe_name},</p>
<p>Confirm this email address to finish creating your ODCC LIVE account.</p>
<p><a href="{safe_url}">Verify my email</a></p>
<p>Or paste this link into your browser:<br>{safe_url}</p>
<p>This link expires in 24 hours. If you did not create an account, ignore this email.</p>
"""
    try:
        await asyncio.to_thread(_send_message, to_email, subject, text, html_body)
    except Exception:
        logger.warning("verification_email_failed", exc_info=True)
        return False
    logger.info("verification_email_sent")
    return True
