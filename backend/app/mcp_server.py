"""Orbit MCP server — company memory for ANY AI agent (Claude Code, Cursor, …).

A Model Context Protocol surface (JSON-RPC over Streamable HTTP) mounted at
/mcp on the existing API. It exposes the same read tools the in-product chat
agent uses — semantic search, learned facts, the entity graph, live stats, and
open findings — so coding agents work with real company context, not just the
repo in front of them.

v1 is strictly READ-ONLY: no ticket drafting, no fact writes, no approvals.
Humans approve things in the product; agents only get eyes.

Auth (v1, honest about its limits):
- MCP_API_KEY set  → every request needs `Authorization: Bearer <key>`; the
  workspace defaults to ws_default and can be chosen per client with an
  `X-Orbit-Workspace` header. One shared key means any key-holder can name any
  workspace — fine for a single-company deployment, NOT for shared SaaS.
  Per-workspace keys are the v2 step.
- MCP_API_KEY unset → served only when Clerk auth is ALSO off (local dev). On
  a Clerk-protected deployment the endpoint refuses instead of exposing
  company memory unauthenticated.
"""
from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from types import SimpleNamespace

from mcp.server.fastmcp import FastMCP
from sqlalchemy import select

from .config import settings
from .database import SessionLocal
from .models import Insight

logger = logging.getLogger("orbit.mcp")


_workspace: ContextVar[str] = ContextVar("mcp_workspace", default="ws_default")

mcp = FastMCP(
    "orbit",
    instructions=(
        "Orbit is this company's shared memory: everything from its connected tools "
        "(Linear, GitHub, Slack, Google Drive, customer calls) plus facts it has learned. "
        "Use search_memory for anything about the company, its customers, decisions, or work "
        "in flight; learned_facts for ownership/decisions/policies; open_findings for what "
        "currently needs attention. Cite the [id: …] items you actually used."
    ),
    stateless_http=True,   
    json_response=True,    
    streamable_http_path="/", 
)


def _ctx(db) -> SimpleNamespace:
    """The chat agent's tools only ever touch ctx.deps — hand them the same deps
    the product chat uses, so source-visibility filtering and ranking behave
    identically on both surfaces."""
    from .agents.orbit_agent import ChatDeps

    return SimpleNamespace(deps=ChatDeps(db=db, ws=_workspace.get(), uid="mcp"))


@mcp.tool()
async def search_memory(query: str, sources: list[str] | None = None, k: int = 8) -> str:
    """Semantic search over the company's unified memory — calls, documents, Linear
    issues, GitHub PRs, Slack threads. Optionally restrict to specific `sources`
    (call list_sources first to see what exists). Returns matching items tagged
    with [id: …] and a snippet."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.search_memory(_ctx(db), query, sources, k)


@mcp.tool()
async def list_sources() -> str:
    """List the kinds of memory available (connector source types) with item counts,
    so you can pick the right `sources` for a targeted search_memory call."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.list_sources(_ctx(db))


@mcp.tool()
async def person_work(name: str) -> str:
    """The work items (Linear issues, GitHub PRs/issues) a named person owns or
    created — the reliable answer to 'what is X working on'."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.person_work(_ctx(db), name)


@mcp.tool()
async def graph_neighbors(entity: str) -> str:
    """The relationship neighborhood around a person, project or customer in the
    company model — who works with whom, what belongs where, which call created
    which commitment."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.graph_neighbors(_ctx(db), entity)


@mcp.tool()
async def memory_stats() -> str:
    """Live quantitative counts over ALL of memory — totals, open vs completed,
    created this week, cycle times, work per assignee/project. Use for any
    'how many / how much / average' question; never guess a number."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.memory_stats(_ctx(db))


@mcp.tool()
async def learned_facts(query: str) -> str:
    """Search the facts Orbit has distilled over time — ownership, decisions,
    policies, deadlines — each with a confidence score and source. Best for
    who-owns / who-decided / how-things-were questions."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.learned_facts(_ctx(db), query)


@mcp.tool()
async def open_findings() -> str:
    """Orbit's current proactive findings over the company: untracked customer
    commitments (gap), promises at risk of slipping (drift), repeated customer
    demand (trend), delivered promises (win), plus the latest company brief.
    Check this before planning work — it is what needs attention right now."""
    async with SessionLocal() as db:
        ws = _workspace.get()
        rows = (await db.execute(
            select(Insight).where(
                Insight.workspace_id == ws, Insight.origin == "model",
                Insight.status == "open")
            .order_by(Insight.created_at.desc()).limit(30))).scalars().all()
    brief = next((r for r in rows if r.kind == "brief"), None)
    findings = [r for r in rows if r.kind != "brief"]
    if not brief and not findings:
        return "No open findings — nothing tracked needs attention right now."
    out: list[str] = []
    if brief:
        out.append(f"COMPANY BRIEF: {brief.title}\n{brief.detail}".strip())
    for f in findings:
        line = f"[{f.kind}] {f.title}"
        if f.detail:
            line += f"\n  {f.detail}"
        if f.action:
            line += "\n  (Orbit has a prepared fix awaiting human approval in the product.)"
        out.append(line)
    return "\n\n".join(out)


def _denied(status: int, message: str):
    body = json.dumps({"error": message}).encode()

    async def app(scope, receive, send):
        await send({
            "type": "http.response.start", "status": status,
            "headers": [(b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})

    return app


def build_asgi_app():
    """The mountable ASGI app: bearer-key gate + workspace header → MCP server."""
    inner = mcp.streamable_http_app()

    async def guarded(scope, receive, send):
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        key = settings.mcp_api_key
        if key:
            supplied = headers.get("authorization", "")
            if supplied.removeprefix("Bearer ").strip() != key:
                await _denied(401, "Missing or invalid Authorization bearer key.")(scope, receive, send)
                return
        elif settings.clerk_jwks_url:
            await _denied(503, "MCP is not configured: set MCP_API_KEY on the server.")(scope, receive, send)
            return
        _workspace.set(headers.get("x-orbit-workspace", "ws_default"))
        await inner(scope, receive, send)

    return guarded


def session_manager():
    """The StreamableHTTP session manager's run() context — the parent app's
    lifespan must enter this (the sub-app's own lifespan never runs)."""
    return mcp.session_manager.run()

asgi_app = build_asgi_app()


class MCPDispatch:
    """Pure-ASGI middleware that serves /mcp (and /mcp/…) directly, bypassing
    router path matching — a bare POST /mcp would otherwise 307-redirect to
    /mcp/, which not every MCP client follows."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and (scope["path"] == "/mcp" or scope["path"].startswith("/mcp/")):
            scope = dict(scope)
            scope["path"] = "/"  # the inner server serves its single endpoint at "/"
            await asgi_app(scope, receive, send)
            return
        await self.app(scope, receive, send)
