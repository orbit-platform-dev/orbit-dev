"""Linear integration — the first non-meeting sensor AND the first real actuator.

Key-based (a Linear personal API key), no OAuth app needed. Reading issues
feeds the gap detector (commitment vs. execution); creating issues is a real
write performed by the sync engine after approval. All calls are live GraphQL —
nothing is fabricated. Failures raise; callers decide how to degrade.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..models import Integration

_API = "https://api.linear.app/graphql"


async def _gql(api_key: str, query: str, variables: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_API, json={"query": query, "variables": variables or {}},
                                headers={"Authorization": api_key})
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if res.status_code != 200 or body.get("errors"):
        detail = (body.get("errors") or [{}])[0].get("message", res.text[:150])
        raise RuntimeError(f"Linear API error: {detail}")
    return body["data"]


async def get_api_key(db) -> str | None:
    integ = await db.get(Integration, "linear")
    return (integ.credentials or {}).get("apiKey") if integ else None


async def validate_key(api_key: str) -> str:
    """Returns the workspace/user name the key belongs to; raises if invalid."""
    data = await _gql(api_key, "{ viewer { name email } organization { name } }")
    return data["organization"]["name"] or data["viewer"]["name"]


async def fetch_open_issues(api_key: str, limit: int = 100) -> list[dict[str, Any]]:
    """Open (not completed/canceled) issues — the execution reality the
    comparator checks commitments against."""
    data = await _gql(api_key, """
      query($n: Int!) {
        issues(first: $n, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
          nodes {
            identifier title url updatedAt
            state { name type }
          }
        }
      }""", {"n": limit})
    return [{
        "identifier": n["identifier"], "title": n["title"], "url": n["url"],
        "updatedAt": n["updatedAt"], "state": n["state"]["name"], "stateType": n["state"]["type"],
    } for n in data["issues"]["nodes"]]


async def fetch_completed_issues(api_key: str, limit: int = 100) -> list[dict[str, Any]]:
    """Recently completed issues — what loop closure checks open commitments
    against (promised work that actually shipped)."""
    data = await _gql(api_key, """
      query($n: Int!) {
        issues(first: $n, orderBy: updatedAt,
               filter: { state: { type: { eq: "completed" } } }) {
          nodes {
            identifier title url updatedAt
            state { name type }
          }
        }
      }""", {"n": limit})
    return [{
        "identifier": n["identifier"], "title": n["title"], "url": n["url"],
        "updatedAt": n["updatedAt"], "state": n["state"]["name"], "stateType": n["state"]["type"],
    } for n in data["issues"]["nodes"]]


async def _first_team_id(api_key: str) -> str:
    data = await _gql(api_key, "{ teams(first: 1) { nodes { id } } }")
    teams = data["teams"]["nodes"]
    if not teams:
        raise RuntimeError("No Linear team found for this API key")
    return teams[0]["id"]


async def create_issue(api_key: str, title: str, description: str) -> dict[str, str]:
    """Really creates the issue. Returns its identifier and URL."""
    team_id = await _first_team_id(api_key)
    data = await _gql(api_key, """
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { identifier url } }
      }""", {"input": {"teamId": team_id, "title": title[:255], "description": description}})
    created = data["issueCreate"]
    if not created["success"]:
        raise RuntimeError("Linear refused to create the issue")
    return {"identifier": created["issue"]["identifier"], "url": created["issue"]["url"]}
