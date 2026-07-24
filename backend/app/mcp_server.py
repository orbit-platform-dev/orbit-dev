"""Orbit MCP server — company memory for ANY AI agent (Claude Code, Cursor, …).

A Model Context Protocol surface (JSON-RPC over Streamable HTTP) mounted at
/mcp on the existing API. It exposes the same read tools the in-product chat
agent uses — semantic search, learned facts, the entity graph, live stats, and
open findings — so coding agents work with real company context, not just the
repo in front of them.

The MCP surface follows the OS loop like the product does:
- Observe: every agent question is logged (query text + hit count, never the
  results), so unanswerable questions become a memory-gap signal the reasoner
  turns into findings ("agents keep asking about X; memory has nothing").
- Propose, never force: `propose_fact` STAGES a fact as a feed item for human
  approval — no agent ever writes company memory directly. Everything else is
  read-only; approvals stay in the product.

Auth — the bearer key IS the tenant credential:
- Per-workspace keys (generated in Integrations, stored as SHA-256): the
  workspace is resolved FROM the key; client headers are never trusted, so a
  customer's key can only ever open that customer's workspace.
- MCP_API_KEY (operator-held ops key, Secret Manager): may select a workspace
  via X-Orbit-Workspace — never distribute it.
- Both unset + Clerk off (local dev): open access to ws_default.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from types import SimpleNamespace

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy import func, select

from .config import settings
from .database import SessionLocal
from .models import Insight, McpQuery, Workspace

logger = logging.getLogger("orbit.mcp")


_workspace: ContextVar[str] = ContextVar("mcp_workspace", default="ws_default")

mcp = FastMCP(
    "orbit",
    instructions=(
        "Orbit is this company's shared memory: everything from its connected tools "
        "(Linear, GitHub, Slack, Google Drive, customer calls) plus facts it has learned. "
        "Use search_memory for anything about the company, its customers, decisions, or work "
        "in flight; learned_facts for ownership/decisions/policies; open_findings for what "
        "currently needs attention. Cite the [id: …] items you actually used. If memory can't "
        "answer or the user needs current state, pull_connector fetches fresh data — then search "
        "again. If you learn a durable company fact, propose_fact stages it for human approval."
    ),
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


def _ctx(db) -> SimpleNamespace:
    """The chat agent's tools only ever touch ctx.deps — hand them the same deps
    the product chat uses, so source-visibility filtering and ranking behave
    identically on both surfaces."""
    from .agents.orbit_agent import ChatDeps

    return SimpleNamespace(deps=ChatDeps(db=db, ws=_workspace.get(), uid="mcp"))


async def _observed(tool: str, query: str, call) -> str:
    """Run one of the chat agent's tools and log the interaction (Observe): the
    query and how much memory answered it — never the results. hits==0 rows feed
    the reasoner's memory-gap detector."""
    async with SessionLocal() as db:
        ctx = _ctx(db)
        out = await call(ctx)
        # Ledger = items a search actually returned; tools that don't use it
        # (graph, facts) signal a miss with a "No …" reply.
        hits = len(ctx.deps.ledger) or (0 if out.startswith("No ") else 1)
        db.add(McpQuery(id=f"mq_{uuid.uuid4().hex[:10]}", workspace_id=_workspace.get(),
                        tool=tool, query=query[:2000], hits=hits,
                        created_at=datetime.now(timezone.utc)))
        await db.commit()
        return out


@mcp.tool()
async def search_memory(query: str, sources: list[str] | None = None, k: int = 8) -> str:
    """Semantic search over the company's unified memory — calls, documents, Linear
    issues, GitHub PRs, Slack threads. Optionally restrict to specific `sources`
    (call list_sources first to see what exists). Returns matching items tagged
    with [id: …] and a snippet."""
    from .agents import orbit_agent

    return await _observed("search_memory", query,
                           lambda ctx: orbit_agent.search_memory(ctx, query, sources, k))


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

    return await _observed("person_work", name,
                           lambda ctx: orbit_agent.person_work(ctx, name))


@mcp.tool()
async def graph_neighbors(entity: str) -> str:
    """The relationship neighborhood around a person, project or customer in the
    company model — who works with whom, what belongs where, which call created
    which commitment."""
    from .agents import orbit_agent

    return await _observed("graph_neighbors", entity,
                           lambda ctx: orbit_agent.graph_neighbors(ctx, entity))


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

    return await _observed("learned_facts", query,
                           lambda ctx: orbit_agent.learned_facts(ctx, query))


@mcp.tool()
async def pull_connector(name: str) -> str:
    """Fetch FRESH data from a connected tool when memory can't answer or the
    user needs current state. `name` is one of linear | github | slack |
    google-drive. After it succeeds, call search_memory again. A big pull keeps
    syncing in the background — answer from current memory and retry shortly."""
    from .agents import orbit_agent

    async with SessionLocal() as db:
        return await orbit_agent.pull_connector(_ctx(db), name)


_MAX_OPEN_PROPOSALS = 20  # flood guard: agents can't bury the feed in proposals


@mcp.tool()
async def propose_fact(fact: str, subject: str = "", why: str = "") -> str:
    """Propose a durable company fact you learned this session — ownership, a
    decision, a policy, a deadline. This only STAGES the fact on Orbit's feed for
    a human to approve; nothing is written to memory until then. `subject` is the
    slot the fact is about (e.g. 'billing owner' or 'ENG-231'); `why` is one line
    of context on where the fact came from."""
    fact = (fact or "").strip()[:1000]
    if not fact:
        return "Nothing to propose."
    dedupe = f"agent-fact:{hashlib.md5(fact.lower().encode()).hexdigest()[:12]}"
    async with SessionLocal() as db:
        ws = _workspace.get()
        open_props = (await db.execute(select(func.count()).select_from(Insight).where(
            Insight.workspace_id == ws, Insight.kind == "note",
            Insight.status == "open"))).scalar_one()
        if open_props >= _MAX_OPEN_PROPOSALS:
            return ("Too many proposals are already awaiting review — "
                    "ask a human to triage the Orbit feed first.")
        existing = (await db.execute(select(Insight).where(
            Insight.workspace_id == ws, Insight.dedupe_key == dedupe,
            Insight.status.in_(("open", "approved", "dismissed"))))).scalars().first()
        if existing:
            return {"open": "Already proposed — awaiting human review on the feed.",
                    "approved": "Already approved and remembered.",
                    "dismissed": "A human already dismissed this exact proposal; do not re-propose it."
                    }[existing.status]
        db.add(Insight(
            id=f"in_{uuid.uuid4().hex[:10]}", workspace_id=ws, origin="model", kind="note",
            title=f"An agent proposed remembering: {fact[:150]}",
            detail=(why or "").strip()[:500],
            entity_ids=[], artifact_ids=[], evidence={}, status="open",
            created_at=datetime.now(timezone.utc), dedupe_key=dedupe,
            action={"type": "remember-fact", "title": fact,
                    "description": (why or "").strip()[:500], "subject": (subject or "").strip()[:200]},
        ))
        await db.commit()
    return "Staged for human approval on the Orbit feed. It becomes memory only if approved."


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


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def _resolve_workspace(headers: dict[str, str]) -> str | None:
    """The bearer key IS the tenant credential: a per-workspace key opens ONLY
    its own workspace (client headers are never trusted). The ops key
    (MCP_API_KEY, operator-held) may select one via X-Orbit-Workspace; with
    auth fully off (local dev) everything lands on ws_default. None = reject."""
    supplied = headers.get("authorization", "").removeprefix("Bearer ").strip()
    if supplied:
        if settings.mcp_api_key and secrets.compare_digest(supplied, settings.mcp_api_key):
            return headers.get("x-orbit-workspace", "ws_default")
        async with SessionLocal() as db:
            ws = (await db.execute(select(Workspace.id).where(
                Workspace.mcp_key_hash == hash_key(supplied)))).scalar_one_or_none()
        if ws:
            return ws
    if not settings.mcp_api_key and not settings.clerk_jwks_url:
        return "ws_default"
    return None


def build_asgi_app():
    """The mountable ASGI app: resolve the tenant from the bearer key → MCP server."""
    inner = mcp.streamable_http_app()

    async def guarded(scope, receive, send):
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        ws = await _resolve_workspace(headers)
        if ws is None:
            await _denied(401, "Missing or invalid Authorization bearer key. "
                               "Generate a workspace key in Orbit → Integrations.")(scope, receive, send)
            return
        _workspace.set(ws)
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
            scope["path"] = "/"  
            await asgi_app(scope, receive, send)
            return
        await self.app(scope, receive, send)
