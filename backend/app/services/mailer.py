"""Outbound email over the Resend HTTP API (httpx only, no SDK).

The only mail Orbit sends is an internal alert to us — nothing reaches customers —
so there is no template layer, just a subject and plain text. Unconfigured is a
NORMAL state (local dev, unverified sender domain), so `alert` reports failure
instead of raising and callers fall back to another channel.
"""

from __future__ import annotations

import logging

import httpx

from ..config import settings

logger = logging.getLogger("orbit.mailer")

_ENDPOINT = "https://api.resend.com/emails"
_TIMEOUT = 10


def configured() -> bool:
    return bool(settings.resend_api_key and _recipients())


def _recipients() -> list[str]:
    """ALERT_EMAIL takes one address or a comma-separated list."""
    return [a.strip() for a in (settings.alert_email or "").split(",") if a.strip()]


async def alert(subject: str, body: str, *, reply_to: str | None = None) -> bool:
    """Mail the team address. True when Resend accepted it, False otherwise.
    `reply_to` makes the alert answerable — replying in the inbox reaches the
    person the alert is about, not this mailbox."""
    if not configured():
        return False
    payload = {
        "from": settings.mail_from,
        "to": _recipients(),
        "subject": subject,
        "text": body,
    }
    if reply_to and "@" in reply_to:
        payload["reply_to"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                _ENDPOINT,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json=payload,
            )
            resp.raise_for_status()
        return True
    except Exception:
        # Includes an unverified sender domain — Resend rejects those with 403.
        logger.warning("alert email failed", exc_info=True)
        return False
