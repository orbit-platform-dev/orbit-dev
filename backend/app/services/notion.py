"""Notion integration — the document sensor for pages and databases.

Same connector seam as Linear/GitHub/Drive. Two Notion-specific facts shape this:
tokens never expire (no refresh path, unlike Drive), and a page's text is not in
the page object — it lives in a tree of blocks that must be walked, so content
costs one request per block page and is only fetched when `last_edited_time` moved.

Read-only by construction: the integration is granted access per page by the user
inside Notion, and nothing here writes.
"""

from __future__ import annotations

import base64
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration

_API = "https://api.notion.com/v1"
_AUTHORIZE = f"{_API}/oauth/authorize"
_TOKEN = f"{_API}/oauth/token"
# Pinned deliberately: Notion breaks response shapes between versions, so the
# parser below is only valid for the version it was written against.
_VERSION = "2022-06-28"

_MAX_PAGES = 30
_BLOCK_PAGE = 100
_MAX_BLOCK_REQUESTS = 12
_MAX_DEPTH = 3
_CONTENT_CLIP = 20000

# Blocks whose children are worth walking (a toggle or column hides real text);
# everything else contributes its own rich text only.
_CONTAINER_TYPES = frozenset(
    {"toggle", "column_list", "column", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout"}
)
_HEADINGS = {"heading_1": "# ", "heading_2": "## ", "heading_3": "### "}


def oauth_configured() -> bool:
    return bool(settings.notion_client_id and settings.notion_client_secret)


def oauth_url(state: str) -> str:
    return (
        _AUTHORIZE
        + "?"
        + urlencode(
            {
                "client_id": settings.notion_client_id,
                "redirect_uri": settings.notion_redirect_uri,
                "response_type": "code",
                "owner": "user",
                "state": state,
            }
        )
    )


async def exchange_code(code: str) -> dict[str, Any]:
    """Notion authenticates the token call with HTTP Basic (client id/secret), not
    a body secret. The token has no expiry, so there is nothing else to persist."""
    basic = base64.b64encode(f"{settings.notion_client_id}:{settings.notion_client_secret}".encode()).decode()
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            _TOKEN,
            json={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.notion_redirect_uri,
            },
            headers={"Authorization": f"Basic {basic}", "Notion-Version": _VERSION},
        )
    if res.status_code != 200:
        raise RuntimeError(f"Notion token exchange failed: {res.text[:150]}")
    body = res.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError("Notion returned no access token")
    return {"accessToken": token, "workspaceName": body.get("workspace_name")}


async def get_auth(db, workspace_id: str = "ws_default") -> str | None:
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "notion"})
    token = ((integ.credentials or {}) if integ else {}).get("accessToken")
    return f"Bearer {token}" if token else None


def _headers(auth: str) -> dict[str, str]:
    return {"Authorization": auth, "Notion-Version": _VERSION}


async def _request(auth: str, method: str, path: str, payload: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.request(method, f"{_API}{path}", headers=_headers(auth), json=payload)
    if res.status_code != 200:
        raise RuntimeError(f"Notion API error {res.status_code}: {res.text[:150]}")
    return res.json()


async def account_name(auth: str) -> str:
    me = await _request(auth, "GET", "/users/me")
    bot = me.get("bot") or {}
    return bot.get("workspace_name") or me.get("name") or "Notion"


def _rich_text(items: list[dict] | None) -> str:
    return "".join(t.get("plain_text") or "" for t in (items or []))


def _block_text(block: dict) -> str:
    """One block's own text, with the markdown shape that makes structure survive
    into extraction and chat (headings, list bullets, code fences)."""
    btype = block.get("type") or ""
    body = block.get(btype) or {}
    text = _rich_text(body.get("rich_text"))
    if not text:
        return ""
    if btype in _HEADINGS:
        return _HEADINGS[btype] + text
    if btype in ("bulleted_list_item", "toggle"):
        return f"- {text}"
    if btype == "numbered_list_item":
        return f"1. {text}"
    if btype == "to_do":
        return f"- [{'x' if body.get('checked') else ' '}] {text}"
    if btype == "quote":
        return f"> {text}"
    if btype == "code":
        return f"```{body.get('language') or ''}\n{text}\n```"
    return text


def _page_title(page: dict) -> str:
    """Titles hide in a property whose name varies by database, so find the one
    typed `title` rather than assuming a key."""
    for prop in (page.get("properties") or {}).values():
        if prop.get("type") == "title":
            title = _rich_text(prop.get("title"))
            if title:
                return title
    return "Untitled"


async def _page_text(auth: str, page_id: str, budget: list[int]) -> str:
    """Depth-first walk of a page's block tree, bounded by `budget` requests so one
    enormous page cannot consume the whole sync."""
    lines: list[str] = []

    async def walk(block_id: str, depth: int) -> None:
        cursor: str | None = None
        while budget[0] > 0:
            budget[0] -= 1
            params = f"?page_size={_BLOCK_PAGE}" + (f"&start_cursor={cursor}" if cursor else "")
            data = await _request(auth, "GET", f"/blocks/{block_id}/children{params}")
            for block in data.get("results", []):
                text = _block_text(block)
                if text:
                    lines.append(("    " * (depth - 1)) + text if depth > 1 else text)
                if (
                    block.get("has_children")
                    and depth < _MAX_DEPTH
                    and (block.get("type") in _CONTAINER_TYPES)
                    and budget[0] > 0
                ):
                    await walk(block["id"], depth + 1)
            if not data.get("has_more"):
                return
            cursor = data.get("next_cursor")

    await walk(page_id, 1)
    return "\n".join(lines).strip()


async def page_exists(auth: str, page_id: str) -> bool:
    """False ONLY when the page is gone or in the Notion trash — the deletion
    signal for reconcile. Transient errors raise; deletion needs proof."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{_API}/pages/{page_id}", headers=_headers(auth))
    if res.status_code in (400, 404):  # unshared or deleted: both mean unreadable
        return False
    if res.status_code != 200:
        raise RuntimeError(f"Notion API error {res.status_code}: {res.text[:150]}")
    return not res.json().get("archived")


async def fetch_documents(
    auth: str,
    since: str | None = None,
    known: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], set[str]]:
    """The most recently edited pages the integration can see. `since` (ISO) stops
    the walk once pages are older than the cursor; `known` maps page id →
    last_edited_time already in memory, so unchanged pages are listed (for
    reconcile) but their blocks are never re-read. Returns (docs, listed_ids)."""
    listing = await _request(
        auth,
        "POST",
        "/search",
        {
            "filter": {"property": "object", "value": "page"},
            "sort": {"direction": "descending", "timestamp": "last_edited_time"},
            "page_size": _MAX_PAGES,
        },
    )
    out: list[dict[str, Any]] = []
    listed: set[str] = set()
    budget = [_MAX_BLOCK_REQUESTS]
    for page in listing.get("results", []):
        edited = page.get("last_edited_time")
        # Sorted newest-first, so the first page older than the cursor ends the walk.
        if since and edited and edited <= since:
            break
        listed.add(page["id"])
        if page.get("archived") or (known and known.get(page["id"]) == edited):
            continue
        try:
            text = await _page_text(auth, page["id"], budget)
        except Exception:
            continue  # one unreadable page must not sink the sync
        if not text:
            continue
        out.append(
            {
                "id": page["id"],
                "source": "notion-page",
                "kind": "doc",
                "title": _page_title(page),
                "content": text[:_CONTENT_CLIP],
                "url": page.get("url"),
                "modifiedAt": edited,
                "createdAt": page.get("created_time"),
                "owner": None,
                "ownerEmail": None,
            }
        )
    return out, listed
