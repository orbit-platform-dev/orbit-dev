"""Ask Orbit — the company brain as a tool-calling agent."""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field

from pydantic_ai import Agent, RunContext, UsageLimits
from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_ai.toolsets import FunctionToolset
from sqlalchemy import func, select

from ..config import settings
from ..models import Artifact, Entity, Insight, Integration
from ..services import embeddings, github, ingestion, learning, linear, memory
from ..services.analytics import memory_stats as _memory_stats
from ..services.model import WORK_SOURCES, search_artifacts, traverse
from ..services.sources import connected_keys, source_visible
from .definitions import SYSTEM_PROMPTS
from .model_service import build_model

logger = logging.getLogger(__name__)

_TOP_K = 8
_MAX_SCAN = 3000
_SNIPPET = 900
_HISTORY_TURNS = 8
_HISTORY_CLIP = 600
_STOPWORDS = frozenset(
    "what is are our the a an of for in on to and or with about show me tell give list how many much who whats".split()
)
_PULLABLE = ("linear", "github", "slack", "google-drive", "fireflies")
_PULL_LABEL = {
    "linear": "Linear",
    "github": "GitHub",
    "slack": "Slack",
    "google-drive": "Google Drive",
    "fireflies": "Fireflies",
}


@dataclass
class ChatDeps:
    db: object
    ws: str
    uid: str
    who: str = ""
    language: str = ""
    ledger: dict[str, tuple[Artifact, float]] = field(default_factory=dict)
    staged_drafts: list[dict] = field(default_factory=list)
    final_text: str = ""
    touched: bool = False


_CJK = "\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af"
_TOKEN_RE = re.compile(rf"[{_CJK}]|(?:(?![{_CJK}])[^\W_]){{2,}}")


def _toks(s: str) -> set[str]:
    return set(_TOKEN_RE.findall((s or "").lower()))


def _name_tokens(v: str) -> set[str]:
    return set(_TOKEN_RE.findall((v or "").split("@")[0].lower()))


def _record(deps: ChatDeps, artifact: Artifact, score: float) -> None:
    prev = deps.ledger.get(artifact.id)
    if prev is None or score > prev[1]:
        deps.ledger[artifact.id] = (artifact, score)


async def _present_sources(db, ws: str) -> list[str]:
    connected = await connected_keys(db, ws)
    rows = (await db.execute(select(Artifact.source).where(Artifact.workspace_id == ws).distinct())).scalars().all()
    return [s for s in rows if s and source_visible(s, connected)]


async def _expand_sources(db, ws: str, requested: list[str]) -> list[str]:
    present = await _present_sources(db, ws)
    out: set[str] = set()
    for raw in requested:
        r = (raw or "").strip().lower()
        if not r:
            continue
        for p in present:
            pl = p.lower()
            if pl == r or pl.startswith(r + "-") or r.startswith(pl) or r in pl:
                out.add(p)
    return sorted(out)


async def _keyword_hits(db, ws: str, query: str, src: list[str] | None, k: int) -> list[Artifact]:
    q = _toks(query) - _STOPWORDS
    if not q:
        return []
    stmt = select(Artifact).where(Artifact.workspace_id == ws)
    if src:
        stmt = stmt.where(Artifact.source.in_(src))
    rows = (await db.execute(stmt.order_by(Artifact.occurred_at.desc()).limit(_MAX_SCAN))).scalars().all()
    scored = [(a, len(q & _toks(f"{a.title} {a.content or ''}"))) for a in rows]
    scored = [(a, n) for a, n in scored if n]
    scored.sort(key=lambda t: (t[1], t[0].occurred_at), reverse=True)
    return [a for a, _ in scored[:k]]


async def _search(
    db, ws: str, query: str, *, sources: list[str] | None = None, k: int = _TOP_K
) -> list[tuple[Artifact, float]]:
    """Hybrid retrieval: semantic (meaning) and keyword (exact terms/identifiers,
    every language) fused by reciprocal rank — so a match neither method alone
    would surface (a paraphrase, or an exact CJK/ID hit) still ranks."""
    connected = await connected_keys(db, ws)
    src = (await _expand_sources(db, ws, sources)) if sources else None
    src = src or None

    vector: list[Artifact] = []
    if embeddings.available():
        qv = await embeddings.embed_query(query)
        if qv is not None:
            hits = await search_artifacts(db, ws, qv, k=k, sources=src, max_distance=1.0 - 0.78)
            vector = [a for a, _ in hits]
    keyword = await _keyword_hits(db, ws, query, src, k)

    scores: dict[str, float] = {}
    arts: dict[str, Artifact] = {}
    for rank, a in enumerate(vector):
        scores[a.id] = scores.get(a.id, 0.0) + 1.0 / (60 + rank)
        arts[a.id] = a
    for rank, a in enumerate(keyword):
        scores[a.id] = scores.get(a.id, 0.0) + 1.0 / (60 + rank)
        arts[a.id] = a

    ranked = sorted(scores.items(), key=lambda t: t[1], reverse=True)
    out = [(arts[i], s) for i, s in ranked if source_visible(arts[i].source, connected)]
    return out[:k]


async def _person_issues(db, ws: str, name: str, cap: int = 15) -> list[Artifact]:
    q = _toks(name)
    rows = (
        (await db.execute(select(Artifact).where(Artifact.workspace_id == ws, Artifact.source.in_(WORK_SOURCES))))
        .scalars()
        .all()
    )
    matched = {
        v
        for a in rows
        for v in ((a.meta or {}).get("assignee"), (a.meta or {}).get("assigneeEmail"))
        if v and (_name_tokens(v) & q)
    }
    if not matched:
        return []
    mine = [
        a for a in rows if (a.meta or {}).get("assignee") in matched or (a.meta or {}).get("assigneeEmail") in matched
    ]
    mine.sort(
        key=lambda a: ((a.meta or {}).get("stateType") not in ("completed", "canceled"), a.occurred_at), reverse=True
    )
    return mine[:cap]


async def default_target(db, ws: str, connector: str) -> tuple[str | None, str | None]:
    try:
        if connector == "github":
            auth = await github.get_auth(db, ws)
            repos = await github.list_repos(auth) if auth else []
            return (repos[0]["fullName"], repos[0]["fullName"]) if repos else (None, None)
        auth = await linear.get_auth(db, ws)
        teams = await linear.list_teams(auth) if auth else []
        return (teams[0]["id"], teams[0]["name"]) if teams else (None, None)
    except Exception:
        return (None, None)


async def build_action(db, ws: str, d: dict, *, proactive: bool = False) -> dict:
    target, label = await default_target(db, ws, d["connector"])
    return {
        "actionId": f"act_{uuid.uuid4().hex[:10]}",
        "type": "create-ticket",
        "connector": d["connector"],
        "title": d["title"],
        "description": d["description"],
        "target": target,
        "targetLabel": label,
        "status": "pending",
        "result": None,
        "proactive": proactive,
    }


async def _connected_pullable(db, ws: str) -> list[str]:
    rows = (
        (
            await db.execute(
                select(Integration).where(
                    Integration.workspace_id == ws, Integration.key.in_(_PULLABLE), Integration.status == "connected"
                )
            )
        )
        .scalars()
        .all()
    )
    return [r.key for r in rows if r.credentials]


async def _run_pull(db, ws: str, connector: str) -> int:
    fn = {
        "linear": ingestion.pull_linear,
        "github": ingestion.pull_github,
        "slack": ingestion.pull_slack,
        "google-drive": ingestion.pull_gdrive,
        "fireflies": ingestion.pull_fireflies,
    }.get(connector)
    return (await fn(db, ws)) if fn else 0


async def _stale_connectors(db, ws: str, threshold_min: int = 10) -> list[tuple[str, int]]:
    from datetime import datetime, timezone

    rows = (
        (
            await db.execute(
                select(Integration).where(
                    Integration.workspace_id == ws, Integration.key.in_(_PULLABLE), Integration.status == "connected"
                )
            )
        )
        .scalars()
        .all()
    )
    out: list[tuple[str, int]] = []
    now = datetime.now(timezone.utc)
    for i in rows:
        cursor = (i.sync_state or {}).get("cursor")
        if not cursor:
            continue
        age = int((now - datetime.fromisoformat(cursor)).total_seconds() // 60)
        if age >= threshold_min:
            out.append((i.key, age))
    return out


async def latest_activity(ctx: RunContext[ChatDeps], sources: list[str] | None = None, k: int = 8) -> str:
    """The newest items in company memory ordered by time. ALWAYS use this (not
    search_memory) for questions about the latest / most recent / newest things,
    what just happened, or today's activity — semantic search cannot rank by
    time. Optionally restrict to `sources`."""
    deps = ctx.deps
    try:
        connected = await connected_keys(deps.db, deps.ws)
        src = (await _expand_sources(deps.db, deps.ws, sources)) if sources else None
        stmt = select(Artifact).where(Artifact.workspace_id == deps.ws)
        if src:
            stmt = stmt.where(Artifact.source.in_(src))
        stmt = stmt.order_by(Artifact.occurred_at.desc()).limit(max(1, min(k or _TOP_K, 12)))
        rows = (await deps.db.execute(stmt)).scalars().all()
    except Exception:
        logger.warning("latest_activity failed", exc_info=True)
        return "Could not read recent activity; try again."
    rows = [a for a in rows if source_visible(a.source, connected)]
    if not rows:
        return "No matching items in memory."
    deps.touched = True
    for a in rows:
        _record(deps, a, 1.0)
    out = "\n\n".join(
        f"[id: {a.id}] ({a.source}, {a.occurred_at:%Y-%m-%d %H:%M} UTC) {a.title}\n{(a.content or '')[:_SNIPPET]}"
        for a in rows
    )
    stale = await _stale_connectors(deps.db, deps.ws)
    if stale:
        out += (
            "\n\nFRESHNESS WARNING: not synced recently — "
            + ", ".join(f"{k} ({m} min ago)" for k, m in stale)
            + ". Newer items may exist upstream: call pull_connector for the relevant source, then call latest_activity again."
        )
    return out


_FULL_READ = 12000


async def read_item(ctx: RunContext[ChatDeps], id: str) -> str:
    """Read ONE item from memory in full by its `[id: …]` — the whole PR or issue
    including its diffs, commit messages, review comments and discussion. Search
    results are truncated, so call this whenever the question is about DETAIL:
    what changed in a PR, why a decision was made, what someone objected to."""
    deps = ctx.deps
    art = await deps.db.get(Artifact, (id or "").strip())
    if art is None or art.workspace_id != deps.ws:
        return f"No item with id '{id}' in this workspace."
    connected = await connected_keys(deps.db, deps.ws)
    if not source_visible(art.source, connected):
        return "That item's source is not connected, so it is not readable."
    _record(deps, art, 1.0)
    deps.touched = True
    head = f"[id: {art.id}] ({art.source}) {art.title}"
    if art.url:
        head += f"\n{art.url}"
    return f"{head}\n\n{(art.content or '')[:_FULL_READ]}"


async def search_memory(ctx: RunContext[ChatDeps], query: str, sources: list[str] | None = None, k: int = 8) -> str:
    """Search the company's memory for artifacts relevant to `query`. Optionally
    restrict to specific `sources` (call list_sources first to see them) so the answer
    stays on topic — e.g. the Google Drive sources for a documents question, GitHub
    sources for pull requests. Returns matching items, each tagged with an [id: …] and
    a snippet; only items returned here can be cited."""
    deps = ctx.deps
    try:
        results = await _search(deps.db, deps.ws, query, sources=sources, k=max(1, min(k or _TOP_K, 12)))
    except Exception:
        logger.warning("search_memory failed", exc_info=True)
        return "Search failed; try again or without a source filter."
    for a, s in results:
        _record(deps, a, s)
    if not results:
        return f"No matching items in memory{f' for sources {sources}' if sources else ''}."
    deps.touched = True
    return "\n\n".join(
        f"[id: {a.id}] ({a.source}) {a.title}\n{(getattr(a, '_hit_snippet', None) or a.content or '')[:_SNIPPET]}"
        for a, _ in results
    )


async def list_sources(ctx: RunContext[ChatDeps]) -> str:
    """List the kinds of memory available (connector source types) with how many items
    each has, so you can pick the right `sources` for a targeted search."""
    connected = await connected_keys(ctx.deps.db, ctx.deps.ws)
    rows = [
        (s, c)
        for s, c in (
            await ctx.deps.db.execute(
                select(Artifact.source, func.count())
                .where(Artifact.workspace_id == ctx.deps.ws)
                .group_by(Artifact.source)
            )
        ).all()
        if source_visible(s, connected)
    ]
    if not rows:
        return "Company memory is empty — nothing has been ingested yet."
    return "Available memory sources (source = item count):\n" + "\n".join(f"- {s}: {c}" for s, c in sorted(rows))


async def person_work(ctx: RunContext[ChatDeps], name: str) -> str:
    """Find the work items (Linear issues, GitHub PRs/issues) a named person owns or
    created — the reliable answer to 'what is X working on'. Results are citable."""
    arts = await _person_issues(ctx.deps.db, ctx.deps.ws, name)
    connected = await connected_keys(ctx.deps.db, ctx.deps.ws)
    arts = [a for a in arts if source_visible(a.source, connected)]
    for a in arts:
        _record(ctx.deps, a, 0.9)
    if not arts:
        return f"No tracked work items found for '{name}'."
    ctx.deps.touched = True
    return "\n".join(
        f"[id: {a.id}] ({a.source}) {a.title} — "
        f"{(a.meta or {}).get('stateType') or (a.meta or {}).get('state') or 'open'}"
        for a in arts
    )


async def graph_neighbors(ctx: RunContext[ChatDeps], entity: str) -> str:
    """The 2-hop relationship neighborhood around a person, project or customer — who
    works with whom, what belongs where. Context for reasoning, not a citation."""
    q = _toks(entity) - _STOPWORDS
    if not q:
        return "Name a person, project or customer to explore."
    db, ws = ctx.deps.db, ctx.deps.ws
    ents = (
        (
            await db.execute(
                select(Entity).where(Entity.workspace_id == ws, Entity.kind.in_(("person", "project", "customer")))
            )
        )
        .scalars()
        .all()
    )
    by_id = {e.id: e for e in ents}
    hit = next(
        (e for e in ents if (_name_tokens(e.name) & q) or any(_name_tokens(a) & q for a in (e.aliases or []))), None
    )
    if not hit:
        return f"No entity matching '{entity}' in the company graph."
    edges = await traverse(db, ws, [hit.id], depth=2)
    if not edges:
        return f"{hit.name} has no recorded relationships yet."
    art_ids = {x for lk in edges for x, t in ((lk.from_id, lk.from_type), (lk.to_id, lk.to_type)) if t == "artifact"}
    titles: dict[str, str] = {}
    if art_ids:
        titles = {
            i: t
            for i, t in (
                await db.execute(select(Artifact.id, Artifact.title).where(Artifact.id.in_(list(art_ids)[:40])))
            ).all()
        }

    def name_of(nid: str, ntype: str) -> str:
        return (by_id[nid].name if (ntype == "entity" and nid in by_id) else titles.get(nid) or "?")[:60]

    ctx.deps.touched = True
    return f"Relationships around {hit.name}:\n" + "\n".join(
        f"- {name_of(lk.from_id, lk.from_type)} —{lk.type}→ {name_of(lk.to_id, lk.to_type)}" for lk in edges[:15]
    )


async def memory_stats(ctx: RunContext[ChatDeps]) -> str:
    """Live quantitative counts over ALL of memory — totals, how many open vs
    completed, created today/this week, average cycle time, work by assignee/project.
    Use for any 'how many / how much / average' question; never guess a number."""
    out = await _memory_stats(ctx.deps.db, ctx.deps.ws)
    if out:
        ctx.deps.touched = True
    return out or "No memory yet to count."


async def learned_facts(ctx: RunContext[ChatDeps], query: str) -> str:
    """Search Orbit's distilled memory — facts it has learned over time, each with a
    confidence and a source. Best for who-owns / who-is-responsible / how-things-were."""
    if not embeddings.available():
        return "Learned-facts search needs AI enabled."
    qv = await embeddings.embed_query(query)
    if qv is None:
        return "Could not search learned facts right now."
    ql = query.lower()
    historical = any(
        w in ql for w in ("last month", "previously", "used to", "earlier", "who owned", "history", "before")
    )
    mems = await memory.search(
        ctx.deps.db, ctx.deps.ws, qv, k=6, statuses=("active", "superseded") if historical else ("active",)
    )
    if not mems:
        return "No learned facts match that."
    ctx.deps.touched = True
    return "\n".join(
        f"- {m.fact} [confidence {int(round(m.confidence * 100))}%"
        + (" · HISTORICAL" if m.status == "superseded" else "")
        + f" · {m.source_ref or 'derived'}]"
        for m, _ in mems
    )


_PULL_WAIT_S = 240


async def _pull_own_session(ws: str, connector: str) -> int:
    """Run a pull on its OWN session so it can outlive the chat request without
    sharing (or blocking on) the request's transaction."""
    from ..database import SessionLocal

    async with SessionLocal() as db:
        return await _run_pull(db, ws, connector)


async def pull_connector(ctx: RunContext[ChatDeps], name: str) -> str:
    """Fetch FRESH data from a connected tool when memory can't answer the question,
    or whenever the user explicitly asks to pull / refresh / re-check / re-sync —
    their instruction always wins over tool-economy rules. `name` is one of
    linear | github | slack | google-drive | fireflies. After it succeeds, call search_memory
    again to use the newly-ingested data."""
    name = (name or "").strip().lower()
    connected = await _connected_pullable(ctx.deps.db, ctx.deps.ws)
    if name not in connected:
        return f"'{name}' isn't connected. Pullable & connected right now: {', '.join(connected) or 'none'}."
    label = _PULL_LABEL.get(name, name)
    task = asyncio.ensure_future(_pull_own_session(ctx.deps.ws, name))
    try:
        n = await asyncio.wait_for(asyncio.shield(task), timeout=_PULL_WAIT_S)
    except asyncio.TimeoutError:
        return (
            f"{label} is a big pull and is still syncing in the background; new items will land "
            "in memory over the next minutes. Answer from current memory NOW, tell the user the "
            f"{label} sync is still running, and suggest asking again shortly."
        )
    except Exception:
        logger.warning("chat-triggered pull failed", exc_info=True)
        return f"Could not pull fresh data from {label} right now."
    return f"Pulled {n} item(s) from {label}. Call search_memory again to use them."


async def draft_ticket(ctx: RunContext[ChatDeps], connector: str, title: str, description: str) -> str:
    """Draft a ticket to close a gap or track a request. This ONLY STAGES a draft for
    the human to review, edit and approve — it never creates or executes anything. Use
    `connector`='github' for code/repo work, otherwise 'linear'. Call this when the user
    asks to file/track something, or when you spot a concrete, trackable gap."""
    connector = connector if connector in ("linear", "github") else "linear"
    title = (title or "").strip()[:255]
    if not title:
        return "A ticket needs a title before it can be drafted."
    action = await build_action(
        ctx.deps.db, ctx.deps.ws, {"connector": connector, "title": title, "description": (description or "").strip()}
    )
    ctx.deps.staged_drafts.append(action)
    return (
        f"Drafted a {_PULL_LABEL.get(connector, connector)} ticket '{title}', staged for the user to "
        "review and approve. Tell them it's ready below."
    )


async def remember_fact(ctx: RunContext[ChatDeps], fact: str, subject: str = "") -> str:
    """Persist a durable fact the user just told you about the company, so Orbit
    remembers it in future conversations. Use ONLY for lasting knowledge the user
    asserts — who owns what, a decision, a policy, a responsibility, a deadline, or a
    correction to something Orbit got wrong. Never for questions, opinions, or
    throwaway remarks. Pass a short `subject` (what the fact is about, e.g. 'billing
    owner' or 'ENG-231') so a later contradicting fact can cleanly replace this one."""
    fact = (fact or "").strip()
    if not fact:
        return "Nothing to remember."
    try:
        mem = await memory.record(
            ctx.deps.db,
            ctx.deps.ws,
            fact=fact[:1000],
            kind="note",
            subject=subject.strip(),
            source_ref=f"Chat · {ctx.deps.who or ctx.deps.uid}",
            importance=0.7,
            base_confidence=0.85,
        )
    except Exception:
        logger.warning("remember_fact failed", exc_info=True)
        return "Could not save that to memory right now."
    if mem is None:
        return "Nothing to remember."
    return f"Remembered: {fact[:120]}"


_TOOLS = [
    search_memory,
    read_item,
    latest_activity,
    list_sources,
    person_work,
    graph_neighbors,
    memory_stats,
    learned_facts,
    pull_connector,
    draft_ticket,
    remember_fact,
]


def _thinking_settings():
    if settings.resolved_agent_model.partition(":")[0] in ("google-gla", "google"):
        try:
            from pydantic_ai.models.google import GoogleModelSettings

            return GoogleModelSettings(google_thinking_config={"include_thoughts": True})
        except Exception:
            return None
    return None


def _build() -> Agent[ChatDeps]:
    reserve = max(0, (settings.agent_request_limit or 5) - 1)
    toolset = FunctionToolset([*_TOOLS, duckduckgo_search_tool()]).filtered(
        lambda ctx, _tool: ctx.usage.requests < reserve
    )
    return Agent(
        build_model(settings.resolved_agent_model),
        deps_type=ChatDeps,
        system_prompt=SYSTEM_PROMPTS["orbit-agent"],
        toolsets=[toolset],
        retries=2,
    )


async def _directives(deps: ChatDeps, question: str) -> str:
    try:
        return await learning.directives_block(deps.db, deps.ws, question) + await learning.directives_block(
            deps.db, deps.ws, question, user_id=deps.uid
        )
    except Exception:
        logger.warning("directives fetch failed", exc_info=True)
        return ""


def _format_history(messages: list[dict] | None) -> str:
    if not messages:
        return ""
    lines: list[str] = []
    for m in messages[-_HISTORY_TURNS:]:
        role = "User" if m.get("role") == "user" else "Orbit"
        content = " ".join((m.get("content") or "").split())[:_HISTORY_CLIP]
        if content:
            lines.append(f"{role}: {content}")
    if not lines:
        return ""
    return "CONVERSATION SO FAR (oldest to newest):\n" + "\n".join(lines) + "\n\n"


async def _recall(deps: ChatDeps, question: str) -> str:
    """Standing context injected into every chat turn: recalled memories plus the
    Feed's own open findings — chat and Feed read the same brain, so 'what's at
    risk?' in chat must answer with what the Feed shows."""
    out = ""
    try:
        rows = (
            (
                await deps.db.execute(
                    select(Insight)
                    .where(
                        Insight.workspace_id == deps.ws,
                        Insight.origin == "model",
                        Insight.kind.notin_(("brief", "note")),
                        Insight.status.in_(("open", "approved")),
                    )
                    .order_by(Insight.created_at.desc())
                    .limit(10)
                )
            )
            .scalars()
            .all()
        )
        if rows:
            flines = "\n".join(
                f"- [{i.kind}] {i.title}" + (f" — {' '.join((i.detail or '').split())[:160]}" if i.detail else "")
                for i in rows
            )
            out += (
                "CURRENT OPEN FINDINGS (Orbit's own analysis, shown on the user's Feed — cite these "
                "directly for questions about risks, gaps, drift or what needs attention):\n" + flines + "\n\n"
            )
    except Exception:
        logger.warning("findings recall failed", exc_info=True)
    if not embeddings.available():
        return out
    try:
        qv = await embeddings.embed_query(question)
        if qv is None:
            return out
        mems = await memory.search(deps.db, deps.ws, qv, k=6, statuses=("active",))
    except Exception:
        logger.warning("recall failed", exc_info=True)
        return out
    if not mems:
        return out
    lines = "\n".join(
        f"- {m.fact} [confidence {int(round(m.confidence * 100))}%"
        + (f" · {m.source_ref}" if m.source_ref else "")
        + "]"
        for m, _ in mems
    )
    return out + (
        "WHAT ORBIT HAS LEARNED SO FAR (prior facts and your own notes — signals to weigh by "
        "confidence and verify against current evidence, not absolute truth):\n" + lines + "\n\n"
    )


def _prompt(question: str, history: list[dict] | None, recall: str = "", language: str = "") -> str:
    hist = _format_history(history)
    lang = f"APP LANGUAGE: {language}\n" if language else ""
    return f"{recall}{hist}{lang}QUESTION: {question}"


def _phase_for(part: ToolCallPart) -> dict | None:
    try:
        args = part.args_as_dict() or {}
    except Exception:
        args = {}
    if part.tool_name == "pull_connector":
        c = (args.get("name") or "").strip().lower()
        return {"type": "phase", "phase": "pulling", "connector": _PULL_LABEL.get(c, c or "a tool")}
    if part.tool_name == "draft_ticket":
        return {"type": "phase", "phase": "drafting"}
    if part.tool_name == "remember_fact":
        return {"type": "phase", "phase": "remembering"}
    if part.tool_name in (
        "search_memory",
        "list_sources",
        "person_work",
        "graph_neighbors",
        "memory_stats",
        "learned_facts",
    ):
        return {"type": "phase", "phase": "retrieving"}
    return None


def _passage(content: str, query: str, width: int = 700) -> str:
    """The slice of content where the query's terms actually appear — so evidence
    shows WHY an item matched (a promise buried in a comment), not just its
    opening. Falls back to the opening when no term is found."""
    text = content or ""
    if len(text) <= width:
        return text
    terms = _toks(query) - _STOPWORDS
    low = text.lower()
    hit = next((low.find(t) for t in terms if low.find(t) >= 0), -1)
    if hit < 0:
        return text[:width]
    start = max(0, hit - width // 3)
    return ("…" if start else "") + text[start : start + width]


def _evidence_block(deps: ChatDeps, question: str, cap: int = 8) -> str:
    items = sorted(deps.ledger.values(), key=lambda t: t[1], reverse=True)[:cap]
    if not items:
        return ""
    lines = [
        f"[id: {a.id}] ({a.source}) {a.title}\n{getattr(a, '_hit_snippet', None) or _passage(a.content or '', question)}"
        for a, _ in items
    ]
    return "EVIDENCE (already retrieved from company memory):\n" + "\n\n".join(lines)


async def _finalize(deps: ChatDeps, question: str) -> str:
    """One fresh, tool-less model call that answers from the evidence the tool
    rounds already gathered. Runs when the budgeted agent loop ends without a
    text answer (request limit hit, or a thinking-only final response), so the
    user always gets a real grounded reply instead of a canned fallback."""
    finalizer = Agent(
        build_model(settings.resolved_agent_model),
        system_prompt=SYSTEM_PROMPTS["orbit-agent"],
        retries=1,
    )
    evidence = _evidence_block(deps, question)
    prompt = (
        f"{evidence}\n\n" if evidence else ""
    ) + f"QUESTION: {question}\n\nAnswer now from the evidence above. If it is insufficient, say so honestly."
    result = await finalizer.run(prompt, usage_limits=UsageLimits(request_limit=1))
    return (result.output or "").strip()


async def stream_events(deps: ChatDeps, question: str, history: list[dict] | None = None):
    directives = await _directives(deps, question)
    recall = await _recall(deps, question)
    agent = _build()
    yield {"type": "phase", "phase": "reasoning"}
    final_parts: list[str] = []
    try:
        async with agent.iter(
            _prompt(question, history, recall, deps.language),
            deps=deps,
            instructions=directives or None,
            model_settings=_thinking_settings(),
            usage_limits=UsageLimits(request_limit=settings.agent_request_limit),
        ) as run:
            async for node in run:
                if Agent.is_call_tools_node(node):
                    async with node.stream(run.ctx) as ts:
                        async for ev in ts:
                            if isinstance(ev, FunctionToolCallEvent):
                                ph = _phase_for(ev.part)
                                if ph:
                                    yield ph
                elif Agent.is_model_request_node(node):
                    cur: list[str] = []
                    had_tool = False
                    async with node.stream(run.ctx) as rs:
                        async for ev in rs:
                            if isinstance(ev, PartStartEvent):
                                p = ev.part
                                if isinstance(p, ThinkingPart) and p.content:
                                    yield {"type": "thinking", "text": p.content}
                                elif isinstance(p, TextPart) and p.content:
                                    cur.append(p.content)
                                    yield {"type": "delta", "text": p.content}
                                elif isinstance(p, ToolCallPart):
                                    had_tool = True
                            elif isinstance(ev, PartDeltaEvent):
                                d = ev.delta
                                if isinstance(d, ThinkingPartDelta) and d.content_delta:
                                    yield {"type": "thinking", "text": d.content_delta}
                                elif isinstance(d, TextPartDelta) and d.content_delta:
                                    cur.append(d.content_delta)
                                    yield {"type": "delta", "text": d.content_delta}
                                elif isinstance(d, ToolCallPartDelta):
                                    had_tool = True
                    if not had_tool and cur:
                        final_parts = cur
        deps.final_text = "".join(final_parts).strip()
    except UsageLimitExceeded:
        logger.warning("agent request budget exhausted; finalizing from gathered evidence")
    if not deps.final_text:
        text = await _finalize(deps, question)
        if text:
            deps.final_text = text
            yield {"type": "delta", "text": text}


async def answer(deps: ChatDeps, question: str, history: list[dict] | None = None) -> str:
    directives = await _directives(deps, question)
    recall = await _recall(deps, question)
    agent = _build()
    result = await agent.run(
        _prompt(question, history, recall, deps.language),
        deps=deps,
        instructions=directives or None,
        usage_limits=UsageLimits(request_limit=settings.agent_request_limit),
    )
    text = (result.output or "").strip()
    deps.final_text = text
    return text


def cite_dicts(deps: ChatDeps, cap: int = 6) -> list[dict]:
    items = sorted(deps.ledger.values(), key=lambda t: t[1], reverse=True)[:cap]
    return [{"id": a.id, "source": a.source, "title": a.title, "url": a.url} for a, _ in items]


_CITE_SIM = 0.75


async def relevant_citations(deps: ChatDeps, answer: str, cap: int = 6) -> list[dict]:
    """Sources that actually back THIS answer. The ledger holds everything any
    tool retrieved during the run, including dead ends the model discarded —
    cite only items the answer names or that are semantically close to it."""
    items = sorted(deps.ledger.values(), key=lambda t: t[1], reverse=True)
    if not items:
        return []
    if not (answer or "").strip() or not embeddings.available():
        return cite_dicts(deps, cap)
    text = answer.lower()
    named = [a for a, _ in items if a.external_ref and a.external_ref.lower() in text]
    av = await embeddings.embed_query(answer[:2000])
    if av is None:
        return cite_dicts(deps, cap)
    close = sorted(
        ((a, embeddings.cosine(av, a.embedding)) for a, _ in items if a.embedding),
        key=lambda t: t[1],
        reverse=True,
    )
    out: list[Artifact] = []
    seen: set[str] = set()
    for a in (*named, *(a for a, sim in close if sim >= _CITE_SIM)):
        if a.id not in seen:
            seen.add(a.id)
            out.append(a)
        if len(out) >= cap:
            break
    if not out and deps.touched:
        out = [a for a, _ in items[:2]]
    return [{"id": a.id, "source": a.source, "title": a.title, "url": a.url} for a in out]


_STATS_WORDS = ("how many", "how much", "count", "total", "average", "avg", "number of", "how long")


def _wants_stats(question: str) -> bool:
    q = (question or "").lower()
    return any(w in q for w in _STATS_WORDS)


def _fallback_text(stats: str, hits: list[Artifact]) -> str:
    if not hits and not stats:
        return (
            "I couldn't run full AI analysis just now and found nothing matching in memory — "
            "the model may be temporarily rate-limited. Try again in a moment."
        )
    parts = ["I couldn't run full AI analysis just now, so here's a quick read straight from memory:"]
    if stats:
        parts.append(stats)
    if hits:
        parts.append("Most relevant items:\n" + "\n".join(f"- {a.title} ({a.source})" for a in hits[:6]))
    return "\n\n".join(parts)


async def keyword_fallback(deps: ChatDeps, question: str) -> tuple[str, list[dict]]:
    try:
        res = await _search(deps.db, deps.ws, question)
    except Exception:
        logger.warning("fallback search failed", exc_info=True)
        res = []
    for a, s in res:
        _record(deps, a, s)
    hits = [a for a, _ in res]
    stats = ""
    if _wants_stats(question):
        try:
            stats = await _memory_stats(deps.db, deps.ws)
        except Exception:
            logger.warning("fallback stats failed", exc_info=True)
    if hits or stats:
        deps.touched = True
    text = _fallback_text(stats, hits)
    deps.final_text = text
    return text, cite_dicts(deps)
