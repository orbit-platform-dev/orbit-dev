"""Linear integration — the first execution-reality sensor AND the first actuator.

Two real auth modes: a personal API key (paste) or OAuth ("Connect with
Linear"). A personal key authenticates as the raw `Authorization` header value;
an OAuth access token as `Authorization: Bearer <token>`. Everything downstream
uses the header value returned by `get_auth`, so the rest of the pipeline is
auth-mode agnostic. All calls are live GraphQL — nothing is fabricated. Failures
raise; callers decide how to degrade.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration

logger = logging.getLogger("orbit.linear")

_API = "https://api.linear.app/graphql"
_AUTHORIZE = "https://linear.app/oauth/authorize"
_TOKEN = "https://api.linear.app/oauth/token"
_SCOPES = "read,write"


def _auth_header(cred: dict[str, Any] | None) -> str | None:
    """OAuth tokens go as `Bearer <token>`; a personal key is the raw value."""
    if not cred:
        return None
    if cred.get("accessToken"):
        return f"Bearer {cred['accessToken']}"
    return cred.get("apiKey") or None


async def get_auth(db, workspace_id: str = "ws_default") -> str | None:
    """The Authorization header value for THIS workspace's Linear connection, or
    None. Scoped by workspace so one tenant never reads another's credential.
    Expiring OAuth tokens refresh in place (flushes; caller commits)."""
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "linear"})
    if not integ:
        return None
    cred = integ.credentials or {}
    if cred.get("refreshToken") and time.time() >= cred.get("expiresAt", 0):
        try:
            integ.credentials = {**cred, **await _refresh(cred["refreshToken"])}
            await db.flush()
            cred = integ.credentials
        except Exception:
            pass  # keep the old token; the sync's own failure handling reports it
    return _auth_header(cred)


async def _refresh(refresh_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            _TOKEN,
            data={
                "client_id": settings.linear_client_id,
                "client_secret": settings.linear_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    if res.status_code != 200:
        raise RuntimeError(f"Linear token refresh failed: {res.text[:150]}")
    body = res.json()
    out = {"accessToken": body["access_token"], "expiresAt": time.time() + body.get("expires_in", 86400) - 60}
    if body.get("refresh_token"):  # Linear rotates refresh tokens — always keep the new one
        out["refreshToken"] = body["refresh_token"]
    return out


async def _gql(auth: str, query: str, variables: dict | None = None) -> dict:
    # public-file-urls-expire-in: uploads.linear.app rejects API auth headers, so
    # image URLs in markdown must come back pre-signed to be downloadable at all.
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            _API,
            json={"query": query, "variables": variables or {}},
            headers={"Authorization": auth, "public-file-urls-expire-in": "86400"},
        )
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if res.status_code != 200 or body.get("errors"):
        detail = (body.get("errors") or [{}])[0].get("message", res.text[:150])
        raise RuntimeError(f"Linear API error: {detail}")
    return body["data"]


async def account_name(auth: str) -> str:
    """The workspace/user name a credential belongs to; raises if invalid."""
    data = await _gql(auth, "{ viewer { name email } organization { name } }")
    return data["organization"]["name"] or data["viewer"]["name"]


async def validate_key(api_key: str) -> str:
    """Personal-API-key connect path: the key itself is the header value."""
    return await account_name(api_key)


# --- OAuth ("Connect with Linear") -----------------------------------------
def oauth_configured() -> bool:
    return bool(settings.linear_client_id and settings.linear_client_secret)


def oauth_url(state: str) -> str:
    return (
        _AUTHORIZE
        + "?"
        + urlencode(
            {
                "client_id": settings.linear_client_id,
                "redirect_uri": settings.linear_redirect_uri,
                "response_type": "code",
                "scope": _SCOPES,
                "state": state,
            }
        )
    )


async def exchange_code(code: str) -> dict[str, Any] | str:
    """Trade the authorization code for tokens. Linear now issues EXPIRING access
    tokens with rotating refresh tokens — persist all three or the connection
    dies within a day. Plain string only for legacy non-expiring responses."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            _TOKEN,
            data={
                "client_id": settings.linear_client_id,
                "client_secret": settings.linear_client_secret,
                "redirect_uri": settings.linear_redirect_uri,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
    if res.status_code != 200:
        raise RuntimeError(f"Linear token exchange failed: {res.text[:150]}")
    body = res.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError("Linear returned no access token")
    if body.get("refresh_token"):
        return {
            "accessToken": token,
            "refreshToken": body["refresh_token"],
            "expiresAt": time.time() + body.get("expires_in", 86400) - 60,
        }
    return token


# --- Sensor reads -----------------------------------------------------------
# Read everything, not just a page: paginate the whole connection. Open issues
# are the live execution reality; recently-completed ones drive loop closure.
_MAX_OPEN = 2000  # effectively "all open work" with a safety ceiling
_MAX_COMPLETED = 500  # recent completions are enough to close commitments

_OPEN_FILTER: dict[str, Any] = {"state": {"type": {"nin": ["completed", "canceled"]}}}
_COMPLETED_FILTER: dict[str, Any] = {"state": {"type": {"eq": "completed"}}}

# Pull the WHOLE ticket, not just name/description — an AI OS needs who owns it,
# which project/team/labels it belongs to, its priority/estimate, and the
# timestamps that give cycle time (how long it took to close).
_ISSUE_FIELDS = (
    "identifier title description url priority priorityLabel estimate "
    "createdAt updatedAt startedAt completedAt canceledAt dueDate "
    "state { name type } "
    "assignee { name email } creator { name } "
    "team { key name } project { name state } "
    "labels(first: 20) { nodes { name } } "
    # The discussion — where blockers, decisions and technical context live.
    "comments(first: 50) { nodes { body createdAt user { name } } }"
)


def _shape(n: dict[str, Any]) -> dict[str, Any]:
    assignee = n.get("assignee") or {}
    project = n.get("project") or {}
    team = n.get("team") or {}
    labels = [lbl["name"] for lbl in (n.get("labels") or {}).get("nodes", []) if lbl.get("name")]
    comments = [
        {
            "author": (c.get("user") or {}).get("name"),
            "createdAt": c.get("createdAt"),
            "body": (c.get("body") or "").strip()[:600],
        }
        for c in (n.get("comments") or {}).get("nodes", [])
        if (c.get("body") or "").strip()
    ]
    return {
        "identifier": n["identifier"],
        "title": n["title"],
        "description": (n.get("description") or "").strip(),
        "url": n["url"],
        "createdAt": n.get("createdAt"),
        "updatedAt": n.get("updatedAt"),
        "startedAt": n.get("startedAt"),
        "completedAt": n.get("completedAt"),
        "canceledAt": n.get("canceledAt"),
        "dueDate": n.get("dueDate"),
        "priority": n.get("priority"),
        "priorityLabel": n.get("priorityLabel"),
        "estimate": n.get("estimate"),
        "state": n["state"]["name"],
        "stateType": n["state"]["type"],
        "assignee": assignee.get("name"),
        "assigneeEmail": assignee.get("email"),
        "creator": (n.get("creator") or {}).get("name"),
        "team": team.get("name"),
        "teamKey": team.get("key"),
        "project": project.get("name"),
        "projectState": project.get("state"),
        "labels": labels,
        "comments": comments,
    }


def _with_since(filt: dict, since: str | None) -> dict:
    return {**filt, "updatedAt": {"gt": since}} if since else filt


async def _fetch_issues(auth: str, filt: dict, max_total: int, newest_first: bool = False) -> list[dict[str, Any]]:
    """Cursor-paginate the issues connection until exhausted or the cap is hit."""
    order = ", orderBy: updatedAt" if newest_first else ""
    query = (
        "query($n: Int!, $after: String, $filter: IssueFilter!) {"
        f" issues(first: $n, after: $after, filter: $filter{order}) {{"
        f" nodes {{ {_ISSUE_FIELDS} }}"
        " pageInfo { hasNextPage endCursor } } }"
    )
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    while len(out) < max_total:
        page = min(50, max_total - len(out))  # smaller pages: each issue now nests comments
        data = await _gql(auth, query, {"n": page, "after": cursor, "filter": filt})
        conn = data["issues"]
        out.extend(_shape(x) for x in conn["nodes"])
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
    return out


async def fetch_open_issues(auth: str, limit: int = _MAX_OPEN, since: str | None = None) -> list[dict[str, Any]]:
    """All open (not completed/canceled) issues, with descriptions."""
    return await _fetch_issues(auth, _with_since(_OPEN_FILTER, since), limit)


async def fetch_completed_issues(
    auth: str, limit: int = _MAX_COMPLETED, since: str | None = None
) -> list[dict[str, Any]]:
    """Recently completed issues (newest first) — what loop closure checks
    open commitments against (promised work that actually shipped)."""
    return await _fetch_issues(auth, _with_since(_COMPLETED_FILTER, since), limit, newest_first=True)


async def _first_team_id(auth: str) -> str:
    data = await _gql(auth, "{ teams(first: 1) { nodes { id } } }")
    teams = data["teams"]["nodes"]
    if not teams:
        raise RuntimeError("No Linear team found for this account")
    return teams[0]["id"]


async def list_teams(auth: str) -> list[dict[str, str]]:
    """Teams the account can file into — the destination picker for a draft."""
    data = await _gql(auth, "{ teams(first: 50) { nodes { id name key } } }")
    return [{"id": t["id"], "name": t["name"], "key": t.get("key", "")} for t in data["teams"]["nodes"]]


async def create_issue(
    auth: str, title: str, description: str, team_id: str | None = None, label_ids: list[str] | None = None
) -> dict[str, str]:
    """Really creates the issue (in team_id, or the first team). Returns identifier + URL."""
    team_id = team_id or await _first_team_id(auth)
    issue_input: dict[str, Any] = {"teamId": team_id, "title": title[:255], "description": description}
    if label_ids:
        issue_input["labelIds"] = label_ids
    data = await _gql(
        auth,
        """
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { id identifier url } }
      }""",
        {"input": issue_input},
    )
    created = data["issueCreate"]
    if not created["success"]:
        raise RuntimeError("Linear refused to create the issue")
    return {
        "id": created["issue"]["id"],
        "identifier": created["issue"]["identifier"],
        "url": created["issue"]["url"],
    }


async def attach_link(auth: str, issue_id: str, url: str, title: str) -> bool:
    """Attach a URL to an issue (shows in Linear's attachment section). Best-effort:
    returns False on failure so evidence attachment never blocks issue creation."""
    try:
        data = await _gql(
            auth,
            """
          mutation($issueId: String!, $url: String!, $title: String) {
            attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success }
          }""",
            {"issueId": issue_id, "url": url, "title": title[:255]},
        )
        return bool(data["attachmentLinkURL"]["success"])
    except Exception:
        logger.warning("Linear attachment failed for %s", url, exc_info=True)
        return False


async def find_or_create_label(auth: str, team_id: str, name: str) -> str | None:
    """Label id for `name` (case-insensitive), creating it on the team if absent.
    Returns None on failure so the caller can still file the issue unlabeled."""
    try:
        data = await _gql(auth, "{ issueLabels(first: 250) { nodes { id name } } }")
        for n in data["issueLabels"]["nodes"]:
            if (n.get("name") or "").strip().lower() == name.strip().lower():
                return n["id"]
        created = await _gql(
            auth,
            """
          mutation($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) { success issueLabel { id } }
          }""",
            {"input": {"name": name, "teamId": team_id}},
        )
        lbl = created["issueLabelCreate"]
        return lbl["issueLabel"]["id"] if lbl.get("success") else None
    except Exception:
        return None


async def upload_file(auth: str, filename: str, content_type: str, data: bytes) -> str | None:
    """Upload bytes to Linear's asset store (2-step: reserve URL → PUT), returning
    the asset URL to embed as `![](url)` in an issue. None on any failure."""
    try:
        res = await _gql(
            auth,
            """
          mutation($contentType: String!, $filename: String!, $size: Int!) {
            fileUpload(contentType: $contentType, filename: $filename, size: $size) {
              success uploadFile { uploadUrl assetUrl headers { key value } }
            }
          }""",
            {"contentType": content_type, "filename": filename, "size": len(data)},
        )
        up = res.get("fileUpload") or {}
        if not up.get("success"):
            return None
        uf = up["uploadFile"]
        headers = {h["key"]: h["value"] for h in (uf.get("headers") or [])}
        headers["Content-Type"] = content_type
        async with httpx.AsyncClient(timeout=30) as client:
            put = await client.put(uf["uploadUrl"], content=data, headers=headers)
        return uf["assetUrl"] if put.status_code in (200, 201, 204) else None
    except Exception:
        return None
