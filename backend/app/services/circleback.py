"""Circleback integration — a meeting-notes sensor that PUSHES, not polls.

Circleback has no readable API: it delivers each finished meeting to an inbound
webhook (routers/webhooks.py), signed HMAC-SHA256 (hex) over the raw body with a
per-webhook signing secret (`whsec_…`) in the `x-signature` header. So "connect"
here means pasting that signing secret; the shaping of a delivered payload into a
memory artifact lives in ingestion (`_circleback_content_meta`), like every other
connector's content builder.
"""

from __future__ import annotations

import hashlib
import hmac


def signature_ok(secret: str | None, body: bytes, header: str | None) -> bool:
    """Verify Circleback's `x-signature`: hex HMAC-SHA256 of the raw body keyed by
    the signing secret. Constant-time compare. No secret configured ⇒ reject —
    unlike a token-in-URL connector, the signature is the only proof of origin."""
    if not secret or not header:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.strip())


async def validate_key(secret: str) -> str:
    """Connect path: the pasted 'key' is Circleback's webhook signing secret.
    There's no API to check it against — it's proven the first time a signed
    delivery verifies — so we only sanity-check the shape and store it."""
    secret = (secret or "").strip()
    if not secret:
        raise RuntimeError("Signing secret is required")
    if not secret.startswith("whsec_"):
        raise RuntimeError("That doesn't look like a Circleback signing secret (expected whsec_…)")
    return "Circleback"
