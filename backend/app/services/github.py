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
_ENRICH_PER_REPO = 10
_CONTRIBUTORS_PER_REPO = 10
_COMMENTS_MAX = 50


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
        res = await client.get(
            f"{_API}{path}",
            params=params or {},
            headers={
                "Authorization": auth,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
    if res.status_code != 200:
        raise RuntimeError(f"GitHub API error {res.status_code}: {res.text[:150]}")
    return res.json()


async def _post(auth: str, path: str, body: dict) -> Any:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            f"{_API}{path}",
            json=body,
            headers={
                "Authorization": auth,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
    if res.status_code not in (200, 201):
        raise RuntimeError(f"GitHub API error {res.status_code}: {res.text[:150]}")
    return res.json()


async def account_name(auth: str) -> str:
    user = await _get(auth, "/user")
    return user.get("login") or user.get("name") or "GitHub account"


async def list_repos(auth: str) -> list[dict[str, str]]:
    """Repos the account can file into — the destination picker for a draft."""
    rows = await _get(
        auth,
        "/user/repos",
        {
            "sort": "pushed",
            "per_page": 50,
            "affiliation": "owner,collaborator,organization_member",
        },
    )
    return [{"fullName": r["full_name"]} for r in rows if r.get("full_name") and not r.get("archived")]


async def create_issue(auth: str, repo: str, title: str, body: str) -> dict[str, str]:
    """Really creates a GitHub issue in `owner/repo`. Returns an identifier shaped
    like the read side (`owner/repo#n`) + the URL, so memory treats it identically."""
    created = await _post(auth, f"/repos/{repo}/issues", {"title": title[:255], "body": body})
    return {"identifier": f"{repo}#{created['number']}", "url": created["html_url"]}


async def validate_key(token: str) -> str:
    return await account_name(f"Bearer {token}")


def oauth_configured() -> bool:
    return bool(settings.github_client_id and settings.github_client_secret)


def oauth_url(state: str) -> str:
    return (
        _AUTHORIZE
        + "?"
        + urlencode(
            {
                "client_id": settings.github_client_id,
                "redirect_uri": settings.github_redirect_uri,
                "scope": _SCOPES,
                "state": state,
            }
        )
    )


async def exchange_code(code: str) -> str:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            _TOKEN,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "redirect_uri": settings.github_redirect_uri,
                "code": code,
            },
        )
    if res.status_code != 200:
        raise RuntimeError(f"GitHub token exchange failed: {res.text[:150]}")
    token = res.json().get("access_token")
    if not token:
        raise RuntimeError("GitHub returned no access token")
    return token


def _shape(repo: str, n: dict[str, Any], is_pr: bool) -> dict[str, Any]:
    labels = [lb["name"] for lb in (n.get("labels") or []) if isinstance(lb, dict) and lb.get("name")]
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
        "createdAt": n.get("created_at"),
        "updatedAt": n.get("updated_at"),
        "closedAt": n.get("closed_at"),
        "mergedAt": n.get("merged_at"),
        "commentCount": n.get("comments"),
        "comments": [],
        "reviews": [],
    }


async def _fetch_comments(auth: str, repo: str, number: str) -> list[dict[str, Any]]:
    """Every discussion comment on an issue or PR, paginated. Image links inside a
    comment body are OCR'd downstream (ingestion folds them into the artifact text),
    so this is how images in GitHub comments reach memory."""
    out: list[dict[str, Any]] = []
    page = 1
    while len(out) < _COMMENTS_MAX:
        rows = await _get(auth, f"/repos/{repo}/issues/{number}/comments", {"per_page": 100, "page": page})
        out.extend(
            {
                "author": (c.get("user") or {}).get("login"),
                "createdAt": c.get("created_at"),
                "body": (c.get("body") or "").strip()[:800],
            }
            for c in rows
            if (c.get("body") or "").strip()
        )
        if len(rows) < 100:
            break
        page += 1
    return out[:_COMMENTS_MAX]


async def _enrich_pr(auth: str, repo: str, item: dict[str, Any]) -> None:
    """Deep-read one open PR: code stats and reviews (comments are fetched for
    every item separately). Each part is independent so a single failed call
    never drops the rest."""
    number = item["identifier"].rsplit("#", 1)[-1]
    try:
        d = await _get(auth, f"/repos/{repo}/pulls/{number}")
        item.update(
            additions=d.get("additions"),
            deletions=d.get("deletions"),
            changedFiles=d.get("changed_files"),
            commits=d.get("commits"),
        )
    except Exception:
        pass
    try:
        reviews = await _get(auth, f"/repos/{repo}/pulls/{number}/reviews", {"per_page": 10})
        item["reviews"] = [
            {
                "reviewer": (r.get("user") or {}).get("login"),
                "state": r.get("state"),
                "body": (r.get("body") or "").strip()[:400],
            }
            for r in reviews
            if r.get("state")
        ]
    except Exception:
        item.setdefault("reviews", [])


async def item_state(auth: str, identifier: str, is_pr: bool) -> str | None:
    """Live state of one `owner/repo#number` ('open'/'closed'/'merged'), or None
    when it no longer exists — the deletion signal for reconcile. 301 means the
    repo was renamed: this ref is dead too (the new name syncs as new artifacts).
    Transient/API errors raise; deletion needs proof, not doubt."""
    repo, _, number = identifier.rpartition("#")
    path = f"/repos/{repo}/{'pulls' if is_pr else 'issues'}/{number}"
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{_API}{path}",
            headers={
                "Authorization": auth,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
    if res.status_code in (301, 404, 410, 451):
        return None
    if res.status_code != 200:
        raise RuntimeError(f"GitHub API error {res.status_code}: {res.text[:150]}")
    d = res.json()
    return "merged" if d.get("merged_at") else (d.get("state") or "open")


async def fetch_work(
    auth: str, since: str | None = None
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """PRs + issues across the account's most recently active repos, with a deep
    read (stats/discussion/reviews) of the open PRs, plus top contributors per
    repo. Returns (items, contributors_by_repo). `since` (ISO) makes the read
    incremental: listings are updated-desc, so stop at the first stale item;
    contributors are refreshed only on full syncs."""
    repos = await _get(
        auth,
        "/user/repos",
        {
            "sort": "pushed",
            "per_page": _MAX_REPOS,
            "affiliation": "owner,collaborator,organization_member",
        },
    )
    out: list[dict[str, Any]] = []
    contributors: dict[str, list[dict[str, Any]]] = {}
    for r in repos:
        full = r.get("full_name")
        if not full:
            continue
        try:
            prs = await _get(
                auth,
                f"/repos/{full}/pulls",
                {"state": "all", "sort": "updated", "direction": "desc", "per_page": _PER_REPO},
            )
            pr_items = [_shape(full, p, True) for p in prs]
            if since:
                pr_items = [x for x in pr_items if (x.get("updatedAt") or "") > since]
            for pr in [s for s in pr_items if s["state"] == "open"][:_ENRICH_PER_REPO]:
                await _enrich_pr(auth, full, pr)  # stats + reviews (open PRs only)

            issue_params = {"state": "all", "sort": "updated", "direction": "desc", "per_page": _PER_REPO}
            if since:
                issue_params["since"] = since
            issues = await _get(auth, f"/repos/{full}/issues", issue_params)
            # The issues endpoint interleaves PRs; keep only real issues.
            issue_items = [_shape(full, i, False) for i in issues if "pull_request" not in i]

            # Full discussion on every item; a 0-comment item skips the API call.
            for it in (*pr_items, *issue_items):
                if it.get("commentCount") == 0:
                    continue
                it["comments"] = await _fetch_comments(auth, full, it["identifier"].rsplit("#", 1)[-1])
            out.extend(pr_items)
            out.extend(issue_items)
        except Exception:
            continue  # a single archived/blocked repo must not sink the sync
        if since:
            continue  # contributors barely change; full syncs refresh them
        try:
            rows = await _get(auth, f"/repos/{full}/contributors", {"per_page": _CONTRIBUTORS_PER_REPO})
            contributors[full] = [
                {"login": c.get("login"), "contributions": c.get("contributions", 0)} for c in rows if c.get("login")
            ]
        except Exception:
            contributors[full] = []
    return out, contributors
