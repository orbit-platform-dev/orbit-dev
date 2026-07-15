"""GitHub integration — the code-reality sensor, same seam as Linear.

Two auth modes, identical to Linear: a personal access token (paste) or OAuth.
Everything downstream is auth-mode agnostic via `get_auth`. All calls are live
REST — nothing fabricated. Failures raise; callers decide how to degrade.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration

_API = "https://api.github.com"
_AUTHORIZE = "https://github.com/login/oauth/authorize"
_TOKEN = "https://github.com/login/oauth/access_token"
_SCOPES = "repo read:org"

_MAX_REPOS = 15
_PER_REPO = 30
_ENRICH_PER_REPO = 8     # open PRs per repo that get the deep read (3 calls each)
_CONTRIBUTORS_PER_REPO = 10


def _auth_header(cred: dict[str, Any] | None) -> str | None:
    if not cred:
        return None
    token = cred.get("accessToken") or cred.get("apiKey")
    return f"Bearer {token}" if token else None


async def get_auth(db, workspace_id: str = "ws_default") -> str | None:
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "github"})
    return _auth_header(integ.credentials) if integ else None


async def _get(auth: str, path: str, params: dict | None = None) -> Any:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{_API}{path}", params=params or {}, headers={
            "Authorization": auth,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
    if res.status_code != 200:
        raise RuntimeError(f"GitHub API error {res.status_code}: {res.text[:150]}")
    return res.json()


async def account_name(auth: str) -> str:
    user = await _get(auth, "/user")
    return user.get("login") or user.get("name") or "GitHub account"


async def validate_key(token: str) -> str:
    return await account_name(f"Bearer {token}")


def oauth_configured() -> bool:
    return bool(settings.github_client_id and settings.github_client_secret)


def oauth_url(state: str) -> str:
    return _AUTHORIZE + "?" + urlencode({
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        "scope": _SCOPES,
        "state": state,
    })


async def exchange_code(code: str) -> str:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_TOKEN, headers={"Accept": "application/json"}, data={
            "client_id": settings.github_client_id,
            "client_secret": settings.github_client_secret,
            "redirect_uri": settings.github_redirect_uri,
            "code": code,
        })
    if res.status_code != 200:
        raise RuntimeError(f"GitHub token exchange failed: {res.text[:150]}")
    token = res.json().get("access_token")
    if not token:
        raise RuntimeError("GitHub returned no access token")
    return token


def _shape(repo: str, n: dict[str, Any], is_pr: bool) -> dict[str, Any]:
    labels = [l["name"] for l in (n.get("labels") or []) if isinstance(l, dict) and l.get("name")]
    assignee = (n.get("assignee") or {}).get("login")
    merged = bool(n.get("merged_at"))
    state = "merged" if merged else (n.get("state") or "open")
    return {
        "identifier": f"{repo}#{n['number']}",
        "title": n.get("title") or "",
        "description": (n.get("body") or "").strip(),
        "url": n.get("html_url"),
        "isPr": is_pr,
        "state": state,
        # completed/merged maps onto Linear's stateType vocabulary so reasoning,
        # stats and memory treat all connectors identically.
        "stateType": "completed" if state in ("merged", "closed") else "started",
        "author": (n.get("user") or {}).get("login"),
        "assignee": assignee or (n.get("user") or {}).get("login"),
        "repo": repo,
        "labels": labels,
        "draft": bool(n.get("draft")),
        "createdAt": n.get("created_at"), "updatedAt": n.get("updated_at"),
        "closedAt": n.get("closed_at"), "mergedAt": n.get("merged_at"),
        "comments": [], "reviews": [],
    }


async def _enrich_pr(auth: str, repo: str, item: dict[str, Any]) -> None:
    """Deep-read one PR: code stats, the discussion and reviews. Each part is
    independent so a single failed call never drops the rest."""
    number = item["identifier"].rsplit("#", 1)[-1]
    try:
        d = await _get(auth, f"/repos/{repo}/pulls/{number}")
        item.update(additions=d.get("additions"), deletions=d.get("deletions"),
                    changedFiles=d.get("changed_files"), commits=d.get("commits"))
    except Exception:
        pass
    try:
        comments = await _get(auth, f"/repos/{repo}/issues/{number}/comments", {"per_page": 8})
        item["comments"] = [
            {"author": (c.get("user") or {}).get("login"), "createdAt": c.get("created_at"),
             "body": (c.get("body") or "").strip()[:600]}
            for c in comments if (c.get("body") or "").strip()
        ]
    except Exception:
        item.setdefault("comments", [])
    try:
        reviews = await _get(auth, f"/repos/{repo}/pulls/{number}/reviews", {"per_page": 10})
        item["reviews"] = [
            {"reviewer": (r.get("user") or {}).get("login"), "state": r.get("state"),
             "body": (r.get("body") or "").strip()[:400]}
            for r in reviews if r.get("state")
        ]
    except Exception:
        item.setdefault("reviews", [])


async def fetch_work(auth: str) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """PRs + issues across the account's most recently active repos, with a deep
    read (stats/discussion/reviews) of the open PRs, plus top contributors per
    repo. Returns (items, contributors_by_repo)."""
    repos = await _get(auth, "/user/repos", {
        "sort": "pushed", "per_page": _MAX_REPOS,
        "affiliation": "owner,collaborator,organization_member",
    })
    out: list[dict[str, Any]] = []
    contributors: dict[str, list[dict[str, Any]]] = {}
    for r in repos:
        full = r.get("full_name")
        if not full:
            continue
        try:
            prs = await _get(auth, f"/repos/{full}/pulls",
                             {"state": "all", "sort": "updated", "direction": "desc", "per_page": _PER_REPO})
            shaped = [_shape(full, p, True) for p in prs]
            for pr in [s for s in shaped if s["state"] == "open"][:_ENRICH_PER_REPO]:
                await _enrich_pr(auth, full, pr)
            out.extend(shaped)
            issues = await _get(auth, f"/repos/{full}/issues",
                                {"state": "all", "sort": "updated", "direction": "desc", "per_page": _PER_REPO})
            # The issues endpoint interleaves PRs; keep only real issues.
            out.extend(_shape(full, i, False) for i in issues if "pull_request" not in i)
        except Exception:
            continue  # a single archived/blocked repo must not sink the sync
        try:
            rows = await _get(auth, f"/repos/{full}/contributors", {"per_page": _CONTRIBUTORS_PER_REPO})
            contributors[full] = [
                {"login": c.get("login"), "contributions": c.get("contributions", 0)}
                for c in rows if c.get("login")
            ]
        except Exception:
            contributors[full] = []
    return out, contributors
