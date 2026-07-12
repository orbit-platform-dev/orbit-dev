"""Linear integration — the first execution-reality sensor AND the first actuator.

Two real auth modes: a personal API key (paste) or OAuth ("Connect with
Linear"). A personal key authenticates as the raw `Authorization` header value;
an OAuth access token as `Authorization: Bearer <token>`. Everything downstream
uses the header value returned by `get_auth`, so the rest of the pipeline is
auth-mode agnostic. All calls are live GraphQL — nothing is fabricated. Failures
raise; callers decide how to degrade.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration

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
    None. Scoped by workspace so one tenant never reads another's credential."""
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "linear"})
    return _auth_header(integ.credentials) if integ else None


async def _gql(auth: str, query: str, variables: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_API, json={"query": query, "variables": variables or {}},
                                headers={"Authorization": auth})
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
    return _AUTHORIZE + "?" + urlencode({
        "client_id": settings.linear_client_id,
        "redirect_uri": settings.linear_redirect_uri,
        "response_type": "code",
        "scope": _SCOPES,
        "state": state,
    })


async def exchange_code(code: str) -> str:
    """Trade the authorization code for a (long-lived) access token."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_TOKEN, data={
            "client_id": settings.linear_client_id,
            "client_secret": settings.linear_client_secret,
            "redirect_uri": settings.linear_redirect_uri,
            "code": code,
            "grant_type": "authorization_code",
        })
    if res.status_code != 200:
        raise RuntimeError(f"Linear token exchange failed: {res.text[:150]}")
    token = res.json().get("access_token")
    if not token:
        raise RuntimeError("Linear returned no access token")
    return token


# --- Sensor reads -----------------------------------------------------------
# Read everything, not just a page: paginate the whole connection. Open issues
# are the live execution reality; recently-completed ones drive loop closure.
_MAX_OPEN = 2000       # effectively "all open work" with a safety ceiling
_MAX_COMPLETED = 500   # recent completions are enough to close commitments

_OPEN_FILTER: dict[str, Any] = {"state": {"type": {"nin": ["completed", "canceled"]}}}
_COMPLETED_FILTER: dict[str, Any] = {"state": {"type": {"eq": "completed"}}}

_ISSUE_FIELDS = "identifier title description url updatedAt state { name type }"


def _shape(n: dict[str, Any]) -> dict[str, Any]:
    return {
        "identifier": n["identifier"], "title": n["title"],
        "description": (n.get("description") or "").strip(),
        "url": n["url"], "updatedAt": n["updatedAt"],
        "state": n["state"]["name"], "stateType": n["state"]["type"],
    }


async def _fetch_issues(auth: str, filt: dict, max_total: int, newest_first: bool = False) -> list[dict[str, Any]]:
    """Cursor-paginate the issues connection until exhausted or the cap is hit."""
    order = ", orderBy: updatedAt" if newest_first else ""
    query = ("query($n: Int!, $after: String, $filter: IssueFilter!) {"
             f" issues(first: $n, after: $after, filter: $filter{order}) {{"
             f" nodes {{ {_ISSUE_FIELDS} }}"
             " pageInfo { hasNextPage endCursor } } }")
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    while len(out) < max_total:
        page = min(100, max_total - len(out))
        data = await _gql(auth, query, {"n": page, "after": cursor, "filter": filt})
        conn = data["issues"]
        out.extend(_shape(x) for x in conn["nodes"])
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
    return out


async def fetch_open_issues(auth: str, limit: int = _MAX_OPEN) -> list[dict[str, Any]]:
    """All open (not completed/canceled) issues, with descriptions."""
    return await _fetch_issues(auth, _OPEN_FILTER, limit)


async def fetch_completed_issues(auth: str, limit: int = _MAX_COMPLETED) -> list[dict[str, Any]]:
    """Recently completed issues (newest first) — what loop closure checks
    open commitments against (promised work that actually shipped)."""
    return await _fetch_issues(auth, _COMPLETED_FILTER, limit, newest_first=True)


async def _first_team_id(auth: str) -> str:
    data = await _gql(auth, "{ teams(first: 1) { nodes { id } } }")
    teams = data["teams"]["nodes"]
    if not teams:
        raise RuntimeError("No Linear team found for this account")
    return teams[0]["id"]


async def create_issue(auth: str, title: str, description: str) -> dict[str, str]:
    """Really creates the issue. Returns its identifier and URL."""
    team_id = await _first_team_id(auth)
    data = await _gql(auth, """
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { identifier url } }
      }""", {"input": {"teamId": team_id, "title": title[:255], "description": description}})
    created = data["issueCreate"]
    if not created["success"]:
        raise RuntimeError("Linear refused to create the issue")
    return {"identifier": created["issue"]["identifier"], "url": created["issue"]["url"]}
