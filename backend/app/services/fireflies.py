"""Fireflies integration — the meeting-notes sensor, same seam as Linear.

Fireflies is an AI note-taker: it records calls and exposes transcripts,
summaries and action items over a GraphQL API. Auth is a personal API key
(Bearer) — the same paste-a-key path as a Linear personal key. All calls are
live GraphQL; failures raise, callers decide how to degrade.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..models import Integration

_API = "https://api.fireflies.ai/graphql"


_PAGE = 50
_MAX_TRANSCRIPTS = 200


def _auth_header(cred: dict[str, Any] | None) -> str | None:
    """Fireflies authenticates every request with `Authorization: Bearer <key>`."""
    if not cred:
        return None
    token = cred.get("apiKey") or cred.get("accessToken")
    return f"Bearer {token}" if token else None


async def get_auth(db, workspace_id: str = "ws_default") -> str | None:
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "fireflies"})
    return _auth_header(integ.credentials) if integ else None


async def _gql(auth: str, query: str, variables: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(_API, json={"query": query, "variables": variables or {}},
                                headers={"Authorization": auth, "Content-Type": "application/json"})
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if res.status_code != 200 or body.get("errors"):
        detail = (body.get("errors") or [{}])[0].get("message", res.text[:150])
        raise RuntimeError(f"Fireflies API error: {detail}")
    return body["data"]


async def account_name(auth: str) -> str:
    """Validate the key with a minimal, always-available query — an invalid key
    makes it error. Fireflies has no reliable no-argument current-user query, so
    we return a generic label rather than risk a schema mismatch on connect."""
    await _gql(auth, "{ transcripts(limit: 1) { id } }")
    return "Fireflies"


async def validate_key(api_key: str) -> str:
    """Personal-API-key connect path: the key is the Bearer token."""
    return await account_name(f"Bearer {api_key}")


_TRANSCRIPTS_QUERY = """
query Transcripts($limit: Int, $skip: Int, $fromDate: DateTime) {
  transcripts(limit: $limit, skip: $skip, fromDate: $fromDate) {
    id
    title
    date
    duration
    transcript_url
    host_email
    organizer_email
    participants
    summary { overview action_items keywords bullet_gist }
    sentences { speaker_name text }
  }
}
"""


def _shape(t: dict[str, Any]) -> dict[str, Any]:
    """One Fireflies transcript → the meeting vocabulary ingestion expects."""
    summary = t.get("summary") or {}
    return {
        "identifier": t.get("id"),
        "title": t.get("title") or "Untitled meeting",
        "date": t.get("date"),
        "duration": t.get("duration"),
        "url": t.get("transcript_url"),
        "host": t.get("host_email") or t.get("organizer_email"),
        "participants": t.get("participants") or [],
        "overview": summary.get("overview") or "",
        "actionItems": summary.get("action_items") or "",
        "keywords": summary.get("keywords") or [],
        "sentences": [
            {"speaker": s.get("speaker_name"), "text": s.get("text")}
            for s in (t.get("sentences") or []) if s.get("text")
        ],
    }


async def fetch_transcripts(auth: str, since: str | None = None) -> list[dict[str, Any]]:
    """Recent transcripts (newest first), shaped. `since` (ISO) narrows to meetings
    after the cursor via Fireflies' native `fromDate`; paginates to the ceiling."""
    out: list[dict[str, Any]] = []
    skip = 0
    while len(out) < _MAX_TRANSCRIPTS:
        page = (await _gql(auth, _TRANSCRIPTS_QUERY, {
            "limit": _PAGE, "skip": skip, "fromDate": since,
        })).get("transcripts") or []
        out.extend(_shape(t) for t in page if t.get("id"))
        if len(page) < _PAGE:
            break
        skip += _PAGE
    return out
