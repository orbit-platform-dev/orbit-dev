"""Slack integration — a conversational sensor.

Ingests threads from the channels the Orbit bot is a member of. Intent,
commitments and customer requests are born in conversation, so Slack threads are
extracted like calls (the LLM Extractor), not deterministically like Linear
issues. OAuth-only (no paste path). Exposes the same small OAuth interface as
`linear` so the integrations router can drive both generically. Live calls;
nothing fabricated.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration

_API = "https://slack.com/api"
_AUTHORIZE = "https://slack.com/oauth/v2/authorize"
_SCOPES = "channels:history,channels:read,groups:history,users:read"


def _auth_header(cred: dict[str, Any] | None) -> str | None:
    if not cred:
        return None
    tok = cred.get("accessToken")
    return f"Bearer {tok}" if tok else None


async def get_auth(db, workspace_id: str = "ws_default") -> str | None:
    """Authorization header for THIS workspace's Slack connection, or None.
    Scoped by workspace so tenants never share a token."""
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "slack"})
    return _auth_header(integ.credentials) if integ else None


async def _call(auth: str, method: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{_API}/{method}", params=params or {},
                               headers={"Authorization": auth})
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if not body.get("ok"):
        raise RuntimeError(f"Slack API error: {body.get('error', res.text[:150])}")
    return body


async def account_name(auth: str) -> str:
    """Workspace name the token belongs to; raises if invalid."""
    data = await _call(auth, "auth.test")
    return data.get("team") or data.get("url") or "Slack workspace"


# --- OAuth (same interface as linear) --------------------------------------
def oauth_configured() -> bool:
    return bool(settings.slack_client_id and settings.slack_client_secret)


def oauth_url(state: str) -> str:
    return _AUTHORIZE + "?" + urlencode({
        "client_id": settings.slack_client_id,
        "scope": _SCOPES,
        "redirect_uri": settings.slack_redirect_uri,
        "state": state,
    })


async def exchange_code(code: str) -> str:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(f"{_API}/oauth.v2.access", data={
            "client_id": settings.slack_client_id,
            "client_secret": settings.slack_client_secret,
            "code": code,
            "redirect_uri": settings.slack_redirect_uri,
        })
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if not body.get("ok"):
        raise RuntimeError(f"Slack token exchange failed: {body.get('error', res.text[:150])}")
    token = body.get("access_token")
    if not token:
        raise RuntimeError("Slack returned no access token")
    return token


# --- Sensor reads ----------------------------------------------------------
async def list_channels(auth: str, limit: int = 200) -> list[dict[str, Any]]:
    """Channels the bot is a member of (public + private) — you invite the bot to
    the channels you want Orbit to watch."""
    data = await _call(auth, "users.conversations", {
        "types": "public_channel,private_channel", "limit": limit, "exclude_archived": "true"})
    return [{"id": c["id"], "name": c.get("name", c["id"])} for c in data.get("channels", [])]


async def fetch_threads(auth: str, channel_id: str, *, history_limit: int = 50,
                        max_threads: int = 20) -> list[dict[str, Any]]:
    """Recent threads (root + replies) in a channel, newest first. Threads only —
    a rooted discussion is a coherent unit of intent, like a mini-call."""
    hist = await _call(auth, "conversations.history", {"channel": channel_id, "limit": history_limit})
    threads: list[dict[str, Any]] = []
    for m in hist.get("messages", []):
        if m.get("subtype") or m.get("reply_count", 0) < 1:
            continue  # skip joins/bot noise and non-threaded messages
        replies = await _call(auth, "conversations.replies", {"channel": channel_id, "ts": m["ts"]})
        text = "\n\n".join((x.get("text") or "").strip() for x in replies.get("messages", []) if x.get("text"))
        threads.append({"ts": m["ts"], "channel": channel_id, "text": text,
                        "reply_count": m.get("reply_count", 0)})
        if len(threads) >= max_threads:
            break
    return threads
