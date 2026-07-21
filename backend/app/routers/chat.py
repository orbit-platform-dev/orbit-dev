"""Ask Orbit — the reasoning layer over company memory, with private per-user
conversation history.

Retrieval is workspace-scoped (semantic when AI is on, keyword+recency else) so
answers see the whole company. Conversations are scoped to (workspace_id,
user_id) so each person's chat is private, even within a shared workspace.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from ..config import settings
from ..deps import get_current_user, get_db
from ..models import ActivityEvent, Artifact, ChatConversation, Entity, Goal, Insight, Integration, Memory
from ..services import embeddings, github, heartbeat, learning, linear, memory, tickets
from ..services.analytics import memory_stats
from ..services.model import search_artifacts
from ..services.workspace import get_workspace_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])

_TOP_K = 8
_MAX_SCAN = 3000         
                         
_HISTORY_TURNS = 8       
_HISTORY_CLIP = 600      
_CHAT_RELEVANCE = 0.78
_CITE_RELEVANCE = 0.82


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Citation(_Camel):
    id: str
    source: str
    title: str
    url: str | None = None


class ChatIn(_Camel):
    message: str
    conversation_id: str | None = None


class ChatOut(_Camel):
    conversation_id: str
    answer: str
    citations: list[Citation] = []
    grounded: bool = True


class Message(_Camel):
    role: str
    content: str
    citations: list[Citation] = []
    grounded: bool = True
    draft: dict | None = None


class ConversationSummary(_Camel):
    id: str
    title: str
    updated_at: datetime


class ConversationDetail(_Camel):
    id: str
    title: str
    messages: list[Message] = []


def _uid(user) -> str:
    return user.get("sub") or "demo_user"


def _now() -> datetime:
    return datetime.now(timezone.utc)


_STOPWORDS = frozenset(
    "what is are our the a an of for in on to and or with about show me tell give list how many much who whats".split()
)


def _toks(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{2,}", (s or "").lower()))


async def _retrieve(db, ws: str, question: str, k: int = _TOP_K) -> list[tuple[Artifact, float]]:
    """Top-k (artifact, relevance) for a question — relevance kept so citations can
    show the MOST relevant sources, not random ones. STRICTLY READ-ONLY.

    Semantic path (AI on): native pgvector cosine similarity via search_artifacts.
    Fallback (AI off / no key): keyword-overlap fraction + recency."""
    if embeddings.available():
        qv = await embeddings.embed_query(question)
        if qv is not None:
            results = await search_artifacts(db, ws, qv, k=k, max_distance=1.0 - _CHAT_RELEVANCE)
            if results:
                return results

    rows = (
        await db.execute(
            select(Artifact).where(Artifact.workspace_id == ws).order_by(Artifact.occurred_at.desc()).limit(_MAX_SCAN)
        )
    ).scalars().all()
    if not rows:
        return []
    q = _toks(question) - _STOPWORDS

    def _kw(a: Artifact) -> float:
        return len(q & _toks(f"{a.title} {a.content or ''}")) / max(len(q), 1)

    ranked = sorted(rows, key=lambda a: (_kw(a), a.occurred_at), reverse=True)
    return [(a, _kw(a)) for a in ranked[:k]]


def _format_history(messages: list[dict] | None) -> str:
    """The last _HISTORY_TURNS messages as a compact block so the model has
    conversational context (follow-ups, pronouns like 'it'/'they'). Each message
    is clipped to bound tokens. '' when there's no prior history."""
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


def _name_tokens(v: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{3,}", (v or "").split("@")[0].lower()))


async def _person_issues(db, ws: str, question: str, cap: int = 15) -> list[Artifact]:
    """When the question names a person (by name or email local-part), return that
    person's work items — Linear issues AND GitHub PRs/issues — so 'what is X
    working on' sees their ACTUAL work, not just the top-k semantic hits."""
    from ..services.model import WORK_SOURCES

    q = _toks(question)
    rows = (await db.execute(
        select(Artifact).where(Artifact.workspace_id == ws, Artifact.source.in_(WORK_SOURCES))
    )).scalars().all()
    matched = {
        v for a in rows for v in ((a.meta or {}).get("assignee"), (a.meta or {}).get("assigneeEmail"))
        if v and (_name_tokens(v) & q)
    }
    if not matched:
        return []
    mine = [a for a in rows
            if (a.meta or {}).get("assignee") in matched or (a.meta or {}).get("assigneeEmail") in matched]
    mine.sort(key=lambda a: ((a.meta or {}).get("stateType") not in ("completed", "canceled"), a.occurred_at),
              reverse=True)
    return mine[:cap]


async def _graph_context(db, ws: str, question: str) -> str:
    """2-hop neighborhood of the entity the question names — relationships the
    flat retrieval can't see (who works with whom, what belongs where)."""
    from ..services.model import traverse

    q = _toks(question) - _STOPWORDS
    if not q:
        return ""
    ents = (await db.execute(select(Entity).where(
        Entity.workspace_id == ws, Entity.kind.in_(("person", "project", "customer"))
    ))).scalars().all()
    by_id = {e.id: e for e in ents}
    hit = next((e for e in ents
                if (_name_tokens(e.name) & q)
                or any(_name_tokens(a) & q for a in (e.aliases or []))), None)
    if not hit:
        return ""
    edges = await traverse(db, ws, [hit.id], depth=2)
    if not edges:
        return ""
    art_ids = {x for lk in edges for x, t in ((lk.from_id, lk.from_type), (lk.to_id, lk.to_type)) if t == "artifact"}
    art_titles: dict[str, str] = {}
    if art_ids:
        rows = (await db.execute(select(Artifact.id, Artifact.title).where(Artifact.id.in_(list(art_ids)[:40])))).all()
        art_titles = {i: t for i, t in rows}

    def name_of(nid: str, ntype: str) -> str:
        if ntype == "entity":
            e = by_id.get(nid)
            return e.name if e else "?"
        return (art_titles.get(nid) or "?")[:60]

    lines = []
    for lk in edges[:15]:
        lines.append(f"- {name_of(lk.from_id, lk.from_type)} —{lk.type}→ {name_of(lk.to_id, lk.to_type)}")
    return f"GRAPH CONTEXT (2 hops around {hit.name}):\n" + "\n".join(lines) + "\n\n"


def _make_cites(arts) -> list[Citation]:
    return [Citation(id=a.id, source=a.source, title=a.title, url=a.url) for a in arts]


def _fallback_text(stats: str, hits) -> str:
    if not hits and not stats:
        return "I don't have any company memory yet. Connect a tool or add a signal and I'll start learning."
    lines = "\n".join(f"- {a.title}" for a in hits[:6])
    return (((stats + "\n\n") if stats else "") + (f"Most relevant memory:\n{lines}" if lines else "")).strip()


async def _build_context(db, ws: str, question: str, history: list[dict] | None) -> tuple[str, list[Artifact], str, dict[str, float]]:
    """Everything the reasoner sees for one question: retrieval (semantic +
    person-graph), live stats, snapshot (insights/goals), learned facts and the
    conversation window. Returns (prompt, hits, stats, scores) — scores maps
    artifact id → cosine relevance, so citations can show only relevant sources."""
    retrieved = await _retrieve(db, ws, question)
    scores = {a.id: s for a, s in retrieved}
    hits = [a for a, _ in retrieved]
    person = await _person_issues(db, ws, question)
    if person:
        seen = {a.id for a in hits}
        hits = (hits + [a for a in person if a.id not in seen])[:20]
    stats = await memory_stats(db, ws)

    insights = (
        await db.execute(
            select(Insight)
            .where(Insight.workspace_id == ws, Insight.status == "open", Insight.kind != "brief")
            .order_by(Insight.created_at.desc())
            .limit(10)
        )
    ).scalars().all()
    goals = (await db.execute(select(Goal).where(Goal.workspace_id == ws, Goal.status == "open").limit(10))).scalars().all()

    snapshot = (stats + "\n\n") if stats else ""
    if goals:
        snapshot += "GOALS:\n" + "\n".join(f"- {g.title}" for g in goals) + "\n\n"
    if insights:
        snapshot += "OPEN SIGNALS:\n" + "\n".join(f"- [{i.kind}] {i.title}" for i in insights) + "\n\n"

    evidence = (
        "EVIDENCE:\n" + "\n\n".join(
            f"[id: {a.id}] ({a.source}) {a.title}\n{(getattr(a, '_hit_snippet', None) or a.content or '')[:900]}"
            for a in hits)
        if hits
        else "EVIDENCE: (nothing relevant found in memory)"
    )

    mem_block = ""
    if embeddings.available():
        qv = await embeddings.embed_query(question)
        if qv is not None:
            ql = question.lower()
            historical = any(w in ql for w in ("last month", "previously", "used to", "earlier", "who owned", "history", "before"))
            mems = await memory.search(db, ws, qv, k=6, statuses=("active", "superseded") if historical else ("active",))
            if mems:
                mem_block = (
                    "LEARNED FACTS (Orbit's memory — trust these; each carries a confidence and a source):\n"
                    + "\n".join(
                        f"- {m.fact}  [confidence {int(round(m.confidence * 100))}%"
                        + (" · HISTORICAL" if m.status == "superseded" else "")
                        + f" · {m.source_ref or 'derived'}]"
                        for m, _ in mems
                    )
                    + "\n\n"
                )
    graph_block = await _graph_context(db, ws, question)
    convo = _format_history(history)
    return f"{convo}QUESTION: {question}\n\n{snapshot}{graph_block}{mem_block}{evidence}", hits, stats, scores


async def _answer(db, ws: str, question: str, history: list[dict] | None = None) -> tuple[str, list[Citation], bool]:
    prompt, hits, stats, _scores = await _build_context(db, ws, question, history)

    if not settings.ai_enabled:
        return (_fallback_text(stats, hits), _make_cites(hits[:6]), bool(hits or stats))

    answer = _fallback_text(stats, hits)
    grounded = bool(hits or stats)
    used = [a.id for a in hits[:3]]
    # Apply phase: pull the past corrections most relevant to THIS question and
    # inject them into the system prompt so the agent doesn't repeat a mistake
    # the team already corrected.
    directives = await learning.directives_block(db, ws, question)
    try:
        from ..agents.definitions import SYSTEM_PROMPTS, build_agent
        from ..agents.schemas import ChatAnswer

        out = (await build_agent(SYSTEM_PROMPTS["orbit-chat"] + directives, ChatAnswer).run(prompt)).output
        answer, grounded = out.answer, out.grounded
        valid = {a.id for a in hits}
        used = [cid for cid in out.citation_ids if cid in valid]
    except Exception:
        logger.warning("orbit-chat failed; using fallback", exc_info=True)

    by_id = {a.id: a for a in hits}
    return (answer, _make_cites([by_id[c] for c in used if c in by_id]), grounded)


async def _owned(db, ws: str, uid: str, cid: str) -> ChatConversation:
    conv = await db.get(ChatConversation, cid)
    if not conv or conv.workspace_id != ws or conv.user_id != uid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conv


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    rows = (
        await db.execute(
            select(ChatConversation)
            .where(ChatConversation.workspace_id == ws, ChatConversation.user_id == _uid(user))
            .order_by(ChatConversation.updated_at.desc())
            .limit(100)
        )
    ).scalars().all()
    return [ConversationSummary(id=c.id, title=c.title, updated_at=c.updated_at) for c in rows]


@router.get("/conversations/{cid}", response_model=ConversationDetail)
async def get_conversation(cid: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    conv = await _owned(db, ws, _uid(user), cid)
    return ConversationDetail(id=conv.id, title=conv.title, messages=[Message(**m) for m in (conv.messages or [])])


@router.delete("/conversations/{cid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(cid: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    conv = await _owned(db, ws, _uid(user), cid)
    await db.delete(conv)
    await db.commit()


@router.post("", response_model=ChatOut)
async def ask(body: ChatIn, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    uid = _uid(user)
    question = (body.message or "").strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required.")

    if body.conversation_id:
        conv = await _owned(db, ws, uid, body.conversation_id)
    else:
        conv = ChatConversation(
            id=f"conv_{uuid.uuid4().hex[:12]}", workspace_id=ws, user_id=uid,
            title=question[:60], messages=[], created_at=_now(), updated_at=_now(),
        )
        db.add(conv)


    history = list(conv.messages or [])

    sync = heartbeat.status(ws).get("sync") or {}
    if sync.get("active"):
        phase = sync.get("phase", "reading")
        answer = ("⏳ I'm still reading and understanding your company from the connected tools "
                  f"(currently: {phase}). {sync.get('message', '')} "
                  "Ask me again in a moment and I'll answer from the full picture.")
        citations, grounded = [], False
    else:
        answer, citations, grounded = await _answer(db, ws, question, history=history)

    msgs = history
    msgs.append({"role": "user", "content": question, "citations": [], "grounded": True})
    msgs.append({"role": "assistant", "content": answer, "citations": [c.model_dump() for c in citations], "grounded": grounded})
    conv.messages = msgs  # reassign so the JSON column change is tracked
    conv.updated_at = _now()
    if not conv.title or conv.title == "New chat":
        conv.title = question[:60]
    await db.commit()

    return ChatOut(conversation_id=conv.id, answer=answer, citations=citations, grounded=grounded)


# --- Streaming (SSE) ---------------------------------------------------------
def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _cites_from_text(text: str, hits: list[Artifact], scores: dict[str, float], cap: int = 6) -> list[Artifact]:
    """Sources for a streamed answer: what the answer explicitly referenced (by
    identifier or title) PLUS retrieved items that are strongly relevant to the
    question (cosine ≥ _CITE_RELEVANCE). Never loosely-related noise — an item
    below the bar and not referenced is dropped. `hits` are relevance-ordered, so
    the shown sources stay in most-relevant-first order."""
    tl = (text or "").lower()
    referenced, relevant = [], []
    for a in hits:
        ident = (a.external_ref or "").lower()
        title = a.title.split("·", 1)[-1].strip().lower()
        if (ident and ident in tl) or (len(title) >= 12 and title[:40] in tl):
            referenced.append(a)
        elif scores.get(a.id, 0.0) >= _CITE_RELEVANCE:
            relevant.append(a)
    out, seen = [], set()
    for a in referenced + relevant:
        if a.id not in seen:
            out.append(a)
            seen.add(a.id)
    return out[:cap]


# --- Ticket drafting: the in-chat closed loop --------------------------------

_TICKET_NOUNS = ("ticket", "issue", "bug", "task", "story", "card")
_ACTION_VERBS = ("create", "file", "open", "raise", "log", "make", "add", "track", "draft")

_DRAFT_SYSTEM = (
    "You turn a user's request into a software ticket draft. First decide if the user is actually "
    "asking to create/file/track a ticket, issue, bug, or task (isActionable). If they are only asking "
    "a question, set isActionable=false. When actionable, write a clear, self-contained title and a "
    "description (context + what's needed + any acceptance criteria implied by the conversation). "
    "Pick connector 'github' if it's about code, a repo, or a PR; otherwise 'linear'. "
    "Never invent facts that aren't in the conversation."
)

_PROACTIVE_SYSTEM = (
    "The user is NOT explicitly asking to create a ticket. Decide whether their message describes a "
    "concrete, trackable problem, bug, or feature request that clearly warrants one (isActionable). Be "
    "conservative: true only for a specific, actionable item — never for general questions or discussion. "
    "When true, draft a clear title + description and pick connector ('github' for code, else 'linear')."
)

_TRACKABLE_HINTS = ("bug", "broken", "crash", "error", "failing", "fails", "regression", "not working",
                    "doesn't work", "issue", "complain", "request", "need", "should", "missing",
                    "feature", "blocked", "flaky", "slow")


class _DraftIntent(BaseModel):
    is_actionable: bool = False
    connector: str = "linear"
    title: str = ""
    description: str = ""


def _maybe_actionable(text: str) -> bool:
    """Cheap gate so the lite draft model only runs on plausibly-actionable turns."""
    t = (text or "").lower()
    return any(n in t for n in _TICKET_NOUNS) and any(v in t for v in _ACTION_VERBS)


def _maybe_trackable(text: str) -> bool:
    """Cheap gate for PROACTIVE offers: a statement that sounds like a problem/request."""
    t = (text or "").lower()
    return any(h in t for h in _TRACKABLE_HINTS)


async def _run_draft(system: str, question: str, history: list[dict] | None) -> dict | None:
    """Lite-model pass: message + recent context → a ticket draft, or None. Shared by
    the explicit ask (_draft_ticket) and the proactive offer (_proactive_draft)."""
    if not settings.ai_enabled:
        return None
    convo = _format_history(history)
    prompt = f"{convo}\n\nUser message: {question}" if convo else f"User message: {question}"
    try:
        from ..agents.definitions import build_agent
        # Lite model on purpose: simple structured task, and it keeps drafting alive
        # when the smart model's free-tier quota is exhausted (429).
        out = (await build_agent(system, _DraftIntent, model=settings.extractor_model).run(prompt)).output
    except Exception:
        logger.warning("ticket draft failed", exc_info=True)
        return None
    if not out.is_actionable or not out.title.strip():
        return None
    connector = out.connector if out.connector in ("linear", "github") else "linear"
    return {"connector": connector, "title": out.title.strip()[:255], "description": out.description.strip()}


async def _draft_ticket(question: str, history: list[dict] | None) -> dict | None:
    return await _run_draft(_DRAFT_SYSTEM, question, history)


async def _proactive_draft(question: str, history: list[dict] | None) -> dict | None:
    return await _run_draft(_PROACTIVE_SYSTEM, question, history)


async def _default_target(db, ws: str, connector: str) -> tuple[str | None, str | None]:
    """A sensible default destination (id, label) for a fresh draft — the first
    team / most-recently-pushed repo. The user can change it in the card."""
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


async def _build_action(db, ws: str, d: dict, *, proactive: bool = False) -> dict:
    target, label = await _default_target(db, ws, d["connector"])
    return {
        "actionId": f"act_{uuid.uuid4().hex[:10]}", "type": "create-ticket",
        "connector": d["connector"], "title": d["title"], "description": d["description"],
        "target": target, "targetLabel": label, "status": "pending", "result": None,
        "proactive": proactive,
    }


def _find_action(conv: ChatConversation, action_id: str) -> dict | None:
    """The draft dict inside a conversation's messages, by actionId (or None)."""
    for m in conv.messages or []:
        d = m.get("draft")
        if d and d.get("actionId") == action_id:
            return d
    return None


# --- Self-decide-to-pull: fetch fresh data when memory can't answer ----------

_PULLABLE = ("linear", "github", "slack", "google-drive")
_PULL_LABEL = {"linear": "Linear", "github": "GitHub", "slack": "Slack", "google-drive": "Google Drive"}
_PULL_SYSTEM = (
    "A question couldn't be answered from memory. Given the connected tools, pick the ONE whose fresh "
    "data would most likely answer it (linear=issues/tickets/roadmap, github=code/PRs/commits, "
    "slack=team conversations, google-drive=docs/specs). If it isn't about company data or no tool fits, "
    "return an empty connector."
)


class _PullPick(BaseModel):
    connector: str = ""


# Keyword → the connector a question is clearly ABOUT. Deterministic routing keeps
# the strategy identical across connectors (docs→Drive, tickets→Linear, code→GitHub,
# messages→Slack), so a doc question never mis-pulls Linear.
_CONNECTOR_HINTS: dict[str, tuple[str, ...]] = {
    "google-drive": ("document", " doc", "docs", "spec", "sheet", "spreadsheet", "slide", "deck",
                     " pdf", "drive", "proposal", "rfc", "one-pager", "prd", "write-up", "notes doc"),
    "github": ("pull request", " pr ", " prs", "commit", "repo", "branch", "merge", "codebase",
               "code review", " ci ", "diff", "pipeline"),
    "linear": ("ticket", "sprint", "backlog", "roadmap", "story", "epic", "linear"),
    "slack": ("slack", "channel", "thread", "message in", "conversation in"),
}


def _hint_connector(question: str) -> str | None:
    """The connector a question is clearly about (by keyword), or None if unclear."""
    t = f" {(question or '').lower()} "
    for key, hints in _CONNECTOR_HINTS.items():
        if any(h in t for h in hints):
            return key
    return None


async def _connected_pullable(db, ws: str) -> list[str]:
    rows = (await db.execute(select(Integration).where(
        Integration.workspace_id == ws, Integration.key.in_(_PULLABLE),
        Integration.status == "connected"))).scalars().all()
    return [r.key for r in rows if r.credentials]


async def _decide_pull(db, ws: str, question: str) -> str | None:
    """Which connected tool to pull for an unanswerable question (or None). Only
    called when memory returned nothing, so the pull latency is worth it."""
    if not settings.ai_enabled:
        return None
    connected = await _connected_pullable(db, ws)
    if not connected:
        return None
    hint = _hint_connector(question)
    if hint:
        # Question is clearly about one tool: pull it iff connected, never another.
        return hint if hint in connected else None
    try:  # ambiguous — let the lite model choose among connected tools
        from ..agents.definitions import build_agent
        pick = (await build_agent(_PULL_SYSTEM, _PullPick, model=settings.extractor_model).run(
            f"Question: {question}\nConnected tools: {', '.join(connected)}")).output.connector
    except Exception:
        logger.warning("pull decision failed", exc_info=True)
        return None
    return pick if pick in connected else None


async def _run_pull(db, ws: str, connector: str) -> None:
    from ..services import ingestion
    fn = {"linear": ingestion.pull_linear, "github": ingestion.pull_github,
          "slack": ingestion.pull_slack, "google-drive": ingestion.pull_gdrive}.get(connector)
    if fn:
        await fn(db, ws)


async def _ticket_habit(db, ws: str) -> bool:
    """Has the team established a ticket-creation habit (recorded on first approval)?
    Gates proactive offers so Orbit only nudges teams that actually want tickets."""
    row = (await db.execute(select(Memory.id).where(
        Memory.workspace_id == ws, Memory.subject == "ticket-habit",
        Memory.status == "active").limit(1))).first()
    return row is not None


@router.post("/stream")
async def ask_stream(body: ChatIn, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    """Token-streamed answer as Server-Sent Events:
    phase → delta* → done{conversationId, citations, grounded}. The conversation
    is persisted when the stream completes (an aborted stream isn't saved)."""
    uid = _uid(user)
    question = (body.message or "").strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required.")

    if body.conversation_id:
        conv = await _owned(db, ws, uid, body.conversation_id)
    else:
        conv = ChatConversation(
            id=f"conv_{uuid.uuid4().hex[:12]}", workspace_id=ws, user_id=uid,
            title=question[:60], messages=[], created_at=_now(), updated_at=_now(),
        )
        db.add(conv)

    history = list(conv.messages or [])

    async def gen():
        try:
            sync = heartbeat.status(ws).get("sync") or {}
            draft_action = None
            if not sync.get("active") and _maybe_actionable(question):
                d = await _draft_ticket(question, history)
                if d:
                    draft_action = await _build_action(db, ws, d)

            if sync.get("active"):
                text = ("I'm still reading and understanding your company from the connected tools "
                        f"(currently: {sync.get('phase', 'reading')}). Ask me again in a moment "
                        "and I'll answer from the full picture.")
                yield _sse({"type": "delta", "text": text})
                citations, grounded = [], False
            elif draft_action:
                yield _sse({"type": "phase", "phase": "drafting"})
                text = (f"I've drafted a {draft_action['connector'].capitalize()} ticket from that — "
                        "review or edit it below, then approve and I'll create it.")
                yield _sse({"type": "delta", "text": text})
                yield _sse({"type": "draft", "draft": draft_action})
                citations, grounded = [], True
            else:
                yield _sse({"type": "phase", "phase": "retrieving"})
                prompt, hits, stats, scores = await _build_context(db, ws, question, history)
                if not hits and not stats:
                    pick = await _decide_pull(db, ws, question)
                    if pick:
                        yield _sse({"type": "phase", "phase": "pulling", "connector": _PULL_LABEL.get(pick, pick)})
                        try:
                            await _run_pull(db, ws, pick)
                        except Exception:
                            logger.warning("chat-triggered pull failed", exc_info=True)
                        prompt, hits, stats, scores = await _build_context(db, ws, question, history)
                grounded = bool(hits or stats)

                if not settings.ai_enabled:
                    text = _fallback_text(stats, hits)
                    yield _sse({"type": "delta", "text": text})
                    citations = _make_cites(hits[:6])
                else:
                    yield _sse({"type": "phase", "phase": "reasoning"})
                    # Team corrections + THIS user's own answer ratings (per-person loop).
                    directives = (await learning.directives_block(db, ws, question)
                                  + await learning.directives_block(db, ws, question, user_id=uid))
                    from pydantic_ai import Agent as _Agent
                    from pydantic_ai.messages import (
                        PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta,
                        ThinkingPart, ThinkingPartDelta,
                    )

                    from ..agents.definitions import SYSTEM_PROMPTS, build_text_agent

                    # Resilience: if the primary model dies before producing any
                    # answer text (503 spikes on preview models), retry once on the
                    # high-quota extractor model before degrading to the raw list.
                    attempts: list[tuple[str | None, bool]] = [(None, True)]
                    if settings.extractor_model and settings.extractor_model != settings.default_model:
                        attempts.append((settings.extractor_model, False))

                    text = ""
                    for model_id, think in attempts:
                        parts: list[str] = []
                        try:
                            agent = build_text_agent(SYSTEM_PROMPTS["orbit-chat-stream"] + directives,
                                                     model=model_id, thinking=think)
                            # Event-level iteration so the model's THINKING streams
                            # to the UI separately from the answer (the GPT trace).
                            async with agent.iter(prompt) as agent_run:
                                async for node in agent_run:
                                    if not _Agent.is_model_request_node(node):
                                        continue
                                    async with node.stream(agent_run.ctx) as rstream:
                                        async for event in rstream:
                                            kind = content = None
                                            if isinstance(event, PartStartEvent):
                                                if isinstance(event.part, ThinkingPart):
                                                    kind, content = "thinking", event.part.content
                                                elif isinstance(event.part, TextPart):
                                                    kind, content = "delta", event.part.content
                                            elif isinstance(event, PartDeltaEvent):
                                                if isinstance(event.delta, ThinkingPartDelta):
                                                    kind, content = "thinking", event.delta.content_delta
                                                elif isinstance(event.delta, TextPartDelta):
                                                    kind, content = "delta", event.delta.content_delta
                                            if kind and content:
                                                if kind == "delta":
                                                    parts.append(content)
                                                yield _sse({"type": kind, "text": content})
                        except Exception:
                            logger.warning("orbit-chat stream failed on %s", model_id or "default model", exc_info=True)
                        text = "".join(parts).strip()
                        if text:
                            break
                    if not text:
                        text = _fallback_text(stats, hits)
                        yield _sse({"type": "delta", "text": text})
                    citations = _make_cites(_cites_from_text(text, hits, scores))

            # Proactive: once the team has the ticket habit, offer to file one for a
            # trackable statement they didn't explicitly ask to track.
            if (draft_action is None and not sync.get("active")
                    and _maybe_trackable(question) and await _ticket_habit(db, ws)):
                pd = await _proactive_draft(question, history)
                if pd:
                    draft_action = await _build_action(db, ws, pd, proactive=True)
                    yield _sse({"type": "draft", "draft": draft_action})

            msgs = history
            msgs.append({"role": "user", "content": question, "citations": [], "grounded": True})
            assistant_msg = {"role": "assistant", "content": text,
                             "citations": [c.model_dump() for c in citations], "grounded": grounded}
            if draft_action:
                assistant_msg["draft"] = draft_action
            msgs.append(assistant_msg)
            conv.messages = msgs
            conv.updated_at = _now()
            if not conv.title or conv.title == "New chat":
                conv.title = question[:60]
            await db.commit()

            yield _sse({"type": "done", "conversationId": conv.id,
                        "citations": [c.model_dump() for c in citations], "grounded": grounded,
                        "draft": draft_action})
        except Exception:
            logger.warning("chat stream errored", exc_info=True)
            yield _sse({"type": "error", "message": "Something went wrong while answering. Please try again."})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class TicketTargets(_Camel):
    linear: list[dict] = []   
    github: list[dict] = []   


@router.get("/ticket-targets", response_model=TicketTargets)
async def ticket_targets(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    """Destinations for a draft: Linear teams + GitHub repos, only for connected tools."""
    out = TicketTargets()
    la = await linear.get_auth(db, ws)
    if la:
        try:
            out.linear = await linear.list_teams(la)
        except Exception:
            logger.warning("linear teams list failed", exc_info=True)
    ga = await github.get_auth(db, ws)
    if ga:
        try:
            out.github = await github.list_repos(ga)
        except Exception:
            logger.warning("github repos list failed", exc_info=True)
    return out


class EditActionIn(_Camel):
    title: str | None = None
    description: str | None = None
    connector: str | None = None
    target: str | None = None
    target_label: str | None = None
    discard: bool = False


@router.patch("/conversations/{cid}/actions/{action_id}")
async def edit_action(cid: str, action_id: str, body: EditActionIn, db=Depends(get_db),
                      ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    """Edit a still-pending draft before approving (or discard it). Title/description
    edits are captured as learning signal, exactly like Feed corrections."""
    conv = await _owned(db, ws, _uid(user), cid)
    draft = _find_action(conv, action_id)
    if not draft:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    if draft.get("status") != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft has already been actioned")
    if body.discard:
        draft["status"] = "discarded"
        flag_modified(conv, "messages")  
        await db.commit()
        return draft
    for field in ("title", "description"):
        v = getattr(body, field)
        if v is not None and v != draft.get(field, ""):
            await learning.record_feedback(db, ws, section="chat-ticket", field=field,
                                           before=str(draft.get(field, "")), after=str(v),
                                           context=draft.get("title", ""))
            draft[field] = v
    if body.connector in ("linear", "github") and body.connector != draft.get("connector"):
        draft["connector"] = body.connector
        if body.target is None:  # connector changed with no explicit target → pick a default
            draft["target"], draft["targetLabel"] = await _default_target(db, ws, body.connector)
    if body.target is not None:
        draft["target"] = body.target
        draft["targetLabel"] = body.target_label or body.target
    flag_modified(conv, "messages")  # nested JSON edit — value-equal reassignment won't persist
    conv.updated_at = _now()
    await db.commit()
    return draft


@router.post("/conversations/{cid}/actions/{action_id}/approve")
async def approve_action(cid: str, action_id: str, db=Depends(get_db),
                         ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    """Approve a draft → really create the issue in the chosen tool, ingest it into
    memory (so it's tracked immediately), and return the live link."""
    conv = await _owned(db, ws, _uid(user), cid)
    draft = _find_action(conv, action_id)
    if not draft:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    if draft.get("status") != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft has already been actioned")

    connector = draft.get("connector")
    title, description = draft.get("title", ""), draft.get("description", "")
    try:
        result = await tickets.create_ticket(db, ws, connector=connector, title=title,
                                             description=description, target=draft.get("target"))
    except PermissionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{connector} did not create the issue: {exc}") from exc

    draft["status"], draft["result"] = "created", result
    flag_modified(conv, "messages")  
    conv.updated_at = _now()
    db.add(ActivityEvent(
        id=f"ac_{uuid.uuid4().hex[:8]}",
        actor={"name": user.get("name", "You"), "isAgent": False}, action="approved",
        target=f"Created {result.get('identifier', 'a ticket')} from chat",
        target_type="chat-ticket", at=_now(),
    ))
    await db.commit()  # the creation is recorded before the best-effort loop-close below

    try:
        await tickets.ingest_created(db, ws, connector, result, title, description)
        await db.commit()
    except Exception:
        logger.warning("post-create ingest failed", exc_info=True)
        await db.rollback()

    # Learn the habit (reinforces) so proactive offers can begin for this team.
    try:
        await memory.record(db, ws, fact="The team creates tickets in Orbit to track work and requests.",
                            kind="preference", subject="ticket-habit", source_ref="Orbit",
                            importance=0.5, base_confidence=0.8)
        await db.commit()
    except Exception:
        logger.warning("habit record failed", exc_info=True)
        await db.rollback()

    return {"actionId": action_id, "status": "created", "result": result}


class RateIn(_Camel):
    rating: str  # "up" | "down"


@router.post("/conversations/{cid}/messages/{index}/rate")
async def rate_answer(cid: str, index: int, body: RateIn, db=Depends(get_db),
                      ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    """Thumbs up/down on an answer → a PER-PERSON learning signal. The rating is
    stored on the message (persists, stays highlighted) and recorded scoped to
    THIS user, so it shapes only their future answers to similar questions — not
    the whole team's."""
    if body.rating not in ("up", "down"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "rating must be 'up' or 'down'")
    uid = _uid(user)
    conv = await _owned(db, ws, uid, cid)
    msgs = list(conv.messages or [])
    if index < 0 or index >= len(msgs) or msgs[index].get("role") != "assistant":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No answer at that position")
    msgs[index] = {**msgs[index], "rating": body.rating}
    conv.messages = msgs
    flag_modified(conv, "messages")
    conv.updated_at = _now()
    question = next((msgs[i].get("content", "") for i in range(index - 1, -1, -1)
                     if msgs[i].get("role") == "user"), "")
    answer = msgs[index].get("content", "")
    try:
        await learning.record_feedback(db, ws, section="chat-answer", field="rating",
                                       before=question[:280], after=f"{body.rating}: {answer[:180]}",
                                       user_id=uid)
    except Exception:
        logger.warning("rating feedback record failed", exc_info=True)
    await db.commit()
    return {"index": index, "rating": body.rating}
