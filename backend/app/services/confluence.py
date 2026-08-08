"""Confluence integration — the document sensor for wiki pages.

Same connector seam as the others, with two Atlassian-specific facts:

- The API host is per-tenant. A token is exchanged for a `cloudId` (via
  accessible-resources) and every call goes to
  `api.atlassian.com/ex/confluence/{cloudId}`, so `get_auth` returns the header
  AND the resolved base URL rather than a bare string.
- Refresh tokens ROTATE. Every refresh returns a new one, and dropping it locks
  the workspace out until the user re-authorizes, so the new value is always
  persisted alongside the access token.

Page bodies arrive as Confluence "storage format" (XHTML), which is flattened to
text here so extraction, embeddings and chat all see the same readable content.
"""

from __future__ import annotations

import html
import re
import time
from typing import Any, NamedTuple
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration

_AUTHORIZE = "https://auth.atlassian.com/authorize"
_TOKEN = "https://auth.atlassian.com/oauth/token"
_RESOURCES = "https://api.atlassian.com/oauth/token/accessible-resources"
_SITE = "https://api.atlassian.com/ex/confluence"

# Granular scopes for the v2 API; offline_access is what yields a refresh token.
# These must match the scopes on the Atlassian app or authorization fails.
# Comment/attachment scopes power Discussion + diagram ingestion; tokens granted
# before they were added simply skip those (best-effort) until reconnect.
_SCOPE = "read:page:confluence read:space:confluence read:comment:confluence read:attachment:confluence offline_access"

_MAX_PAGES = 30
_CONTENT_CLIP = 20000

_BLOCK_BREAKS = re.compile(r"</(?:p|h[1-6]|li|tr|t[dh]|div|blockquote|ac:[^>]+)>|<br\s*/?>", re.I)
_LIST_ITEM = re.compile(r"<li[^>]*>", re.I)
_TAGS = re.compile(r"<[^>]+>")
_BLANK_LINES = re.compile(r"\n{3,}")
# Embedded diagrams/screenshots: <ac:image><ri:attachment ri:filename="x.png"/></ac:image>
_AC_IMAGE = re.compile(r'<ac:image[^>]*>.*?ri:filename="([^"]+)".*?</ac:image>', re.I | re.S)


class Session(NamedTuple):
    """Everything a Confluence call needs: the bearer header, the tenant-specific
    API base, and the site URL that turns a relative page link into a real one."""

    auth: str
    base: str
    site: str


def oauth_configured() -> bool:
    return bool(settings.confluence_client_id and settings.confluence_client_secret)


def oauth_url(state: str) -> str:
    return (
        _AUTHORIZE
        + "?"
        + urlencode(
            {
                "audience": "api.atlassian.com",
                "client_id": settings.confluence_client_id,
                "scope": _SCOPE,
                "redirect_uri": settings.confluence_redirect_uri,
                "state": state,
                "response_type": "code",
                "prompt": "consent",
            }
        )
    )


async def _token_call(payload: dict) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_TOKEN, json=payload)
    if res.status_code != 200:
        raise RuntimeError(f"Confluence token call failed: {res.text[:150]}")
    body = res.json()
    if not body.get("access_token"):
        raise RuntimeError("Confluence returned no access token")
    return {
        "accessToken": body["access_token"],
        "refreshToken": body.get("refresh_token"),
        "expiresAt": time.time() + body.get("expires_in", 3600) - 60,
    }


async def _site(auth: str) -> dict[str, str]:
    """The Confluence site this token can reach. Multiple sites are possible; the
    first is used, which is the single-site case every customer starts from."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(_RESOURCES, headers={"Authorization": auth, "Accept": "application/json"})
    if res.status_code != 200:
        raise RuntimeError(f"Confluence site lookup failed {res.status_code}: {res.text[:150]}")
    for resource in res.json() or []:
        if any("confluence" in s for s in (resource.get("scopes") or [])):
            return {"cloudId": resource["id"], "siteUrl": resource.get("url") or "", "name": resource.get("name") or ""}
    raise RuntimeError("This Atlassian account has no Confluence site Orbit can read")


async def exchange_code(code: str) -> dict[str, Any]:
    """Resolves the cloudId here so the credential is self-contained: every later
    call knows its host without another lookup."""
    cred = await _token_call(
        {
            "grant_type": "authorization_code",
            "client_id": settings.confluence_client_id,
            "client_secret": settings.confluence_client_secret,
            "code": code,
            "redirect_uri": settings.confluence_redirect_uri,
        }
    )
    return {**cred, **await _site(f"Bearer {cred['accessToken']}")}


async def get_auth(db, workspace_id: str = "ws_default") -> Session | None:
    """Session for this workspace, refreshing the expired access token in place.
    The rotated refresh token is persisted with it. Flushes; caller commits."""
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "confluence"})
    cred = (integ.credentials or {}) if integ else {}
    if not cred.get("accessToken") or not cred.get("cloudId"):
        return None
    if time.time() >= cred.get("expiresAt", 0):
        if not cred.get("refreshToken"):
            raise RuntimeError("Confluence token expired with no refresh token; reconnect required")
        fresh = await _token_call(
            {
                "grant_type": "refresh_token",
                "client_id": settings.confluence_client_id,
                "client_secret": settings.confluence_client_secret,
                "refresh_token": cred["refreshToken"],
            }
        )
        # Atlassian rotates the refresh token: keep the new one or the next
        # refresh fails with invalid_grant and the user must reconnect.
        integ.credentials = {**cred, **{k: v for k, v in fresh.items() if v}}
        await db.flush()
        cred = integ.credentials
    return Session(
        auth=f"Bearer {cred['accessToken']}",
        base=f"{_SITE}/{cred['cloudId']}/wiki/api/v2",
        site=cred.get("siteUrl") or "",
    )


async def account_name(auth: str) -> str:
    return (await _site(auth)).get("name") or "Confluence"


def _storage_text(value: str, page_id: str = "", base: str = "") -> str:
    """Confluence storage format (XHTML) → readable text. Block tags become line
    breaks, list items keep their bullet, everything else is stripped. Embedded
    attachment images become markdown images (download URL on the authed API
    host) BEFORE tag-stripping, so ingestion's vision pass can read diagrams."""
    text = value or ""
    if page_id and base:
        wiki = base.removesuffix("/api/v2")
        text = _AC_IMAGE.sub(lambda m: f"\n![{m.group(1)}]({wiki}/download/attachments/{page_id}/{m.group(1)})\n", text)
    text = _BLOCK_BREAKS.sub("\n", text)
    text = _LIST_ITEM.sub("- ", text)
    text = _TAGS.sub("", text)
    text = html.unescape(text)
    return _BLANK_LINES.sub("\n\n", text).strip()


async def _get(session: Session, path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            f"{session.base}{path}",
            params=params or {},
            headers={"Authorization": session.auth, "Accept": "application/json"},
        )
    if res.status_code != 200:
        raise RuntimeError(f"Confluence API error {res.status_code}: {res.text[:150]}")
    return res.json()


async def _page_comments(session: Session, page_id: str) -> str:
    """Footer comments as Discussion lines (same shape as Linear issue comments).
    Best-effort: tokens granted before the comment scope was added get a 403 here
    and simply skip — never a failed sync."""
    try:
        data = await _get(session, f"/pages/{page_id}/footer-comments", {"body-format": "storage", "limit": 25})
    except Exception:
        return ""
    lines = []
    for c in data.get("results", []):
        body = ((c.get("body") or {}).get("storage") or {}).get("value") or ""
        text = _storage_text(body)
        if text:
            lines.append(f"- {text[:600]}")
    return "Discussion:\n" + "\n".join(lines) if lines else ""


async def page_exists(session: Session, page_id: str) -> bool:
    """False ONLY when the page is gone or trashed — the deletion signal for
    reconcile. Transient errors raise; deletion needs proof."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{session.base}/pages/{page_id}",
            headers={"Authorization": session.auth, "Accept": "application/json"},
        )
    if res.status_code == 404:
        return False
    if res.status_code != 200:
        raise RuntimeError(f"Confluence API error {res.status_code}: {res.text[:150]}")
    return (res.json().get("status") or "current") == "current"


async def fetch_documents(
    session: Session,
    since: str | None = None,
    known: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], set[str]]:
    """The most recently modified pages, newest first. `since` (ISO) ends the walk
    at the cursor; `known` maps page id → modified time already in memory so
    unchanged pages are listed (for reconcile) but not re-parsed.
    Returns (docs, listed_ids)."""
    listing = await _get(
        session,
        "/pages",
        {"limit": _MAX_PAGES, "sort": "-modified-date", "body-format": "storage", "status": "current"},
    )
    out: list[dict[str, Any]] = []
    listed: set[str] = set()
    for page in listing.get("results", []):
        version = page.get("version") or {}
        modified = version.get("createdAt")
        if since and modified and modified <= since:
            break
        page_id = str(page["id"])
        listed.add(page_id)
        if known and known.get(page_id) == modified:
            continue
        body = ((page.get("body") or {}).get("storage") or {}).get("value") or ""
        text = _storage_text(body, page_id=page_id, base=session.base)
        if not text:
            continue
        discussion = await _page_comments(session, page_id)
        if discussion:
            text = f"{text}\n\n{discussion}"
        webui = ((page.get("_links") or {}).get("webui")) or ""
        out.append(
            {
                "id": page_id,
                "source": "confluence-page",
                "kind": "doc",
                "title": page.get("title") or "Untitled",
                "content": text[:_CONTENT_CLIP],
                "url": f"{session.site}/wiki{webui}" if webui and session.site else None,
                "modifiedAt": modified,
                "createdAt": page.get("createdAt"),
                "owner": None,
                "ownerEmail": None,
            }
        )
    return out, listed
