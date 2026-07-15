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

from ..config import settings
from ..deps import get_current_user, get_db
from ..models import Artifact, ChatConversation, Goal, Insight
from ..services import embeddings, heartbeat, learning, memory
from ..services.analytics import memory_stats
from ..services.model import search_artifacts
from ..services.workspace import get_workspace_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])

_TOP_K = 8
_MAX_SCAN = 200          # keyword-fallback window ONLY (no-AI path); the vector
                         # path is index-backed and uncapped.
_HISTORY_TURNS = 8       # sliding window of recent messages given to the model
_HISTORY_CLIP = 600      # per-message char cap, to bound the token budget


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


def _toks(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{2,}", (s or "").lower()))


async def _retrieve(db, ws: str, question: str, k: int = _TOP_K) -> list[Artifact]:
    """Top-k artifacts for a question. STRICTLY READ-ONLY: artifacts are embedded
    at ingest, so this never generates or writes vectors.

    Semantic path (AI on): native pgvector similarity via services.model
    .search_artifacts — index-accelerated on Postgres, uncapped over all history,
    with a similarity floor. Fallback (AI off / no key): keyword overlap + recency
    over a bounded recent window."""
    if embeddings.available():
        qv = await embeddings.embed_query(question)
        if qv is not None:
            results = await search_artifacts(db, ws, qv, k=k)
            if results:
                return [art for art, _sim in results]

    rows = (
        await db.execute(
            select(Artifact).where(Artifact.workspace_id == ws).order_by(Artifact.occurred_at.desc()).limit(_MAX_SCAN)
        )
    ).scalars().all()
    if not rows:
        return []
    q = _toks(question)
    ranked = sorted(rows, key=lambda a: (len(q & _toks(f"{a.title} {a.content or ''}")), a.occurred_at), reverse=True)
    return ranked[:k]


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


def _make_cites(arts) -> list[Citation]:
    return [Citation(id=a.id, source=a.source, title=a.title, url=a.url) for a in arts]


def _fallback_text(stats: str, hits) -> str:
    if not hits and not stats:
        return "I don't have any company memory yet. Connect a tool or add a signal and I'll start learning."
    lines = "\n".join(f"- {a.title}" for a in hits[:6])
    return (((stats + "\n\n") if stats else "") + (f"Most relevant memory:\n{lines}" if lines else "")).strip()


async def _build_context(db, ws: str, question: str, history: list[dict] | None) -> tuple[str, list[Artifact], str]:
    """Everything the reasoner sees for one question: retrieval (semantic +
    person-graph), live stats, snapshot (insights/goals), learned facts and the
    conversation window. Returns (prompt, hits, stats)."""
    hits = await _retrieve(db, ws, question)
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
        "EVIDENCE:\n" + "\n\n".join(f"[id: {a.id}] ({a.source}) {a.title}\n{(a.content or '')[:800]}" for a in hits)
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
    convo = _format_history(history)
    return f"{convo}QUESTION: {question}\n\n{snapshot}{mem_block}{evidence}", hits, stats


async def _answer(db, ws: str, question: str, history: list[dict] | None = None) -> tuple[str, list[Citation], bool]:
    prompt, hits, stats = await _build_context(db, ws, question, history)

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


def _cites_from_text(text: str, hits: list[Artifact], cap: int = 6) -> list[Artifact]:
    """Citations for a streamed (plain-text) answer: the evidence items the text
    actually references — by identifier (ENG-432) or title — else the top hits."""
    tl = (text or "").lower()
    used = []
    for a in hits:
        ident = (a.external_ref or "").lower()
        title = a.title.split("·", 1)[-1].strip().lower()
        if (ident and ident in tl) or (len(title) >= 12 and title[:40] in tl):
            used.append(a)
    return (used or hits[:3])[:cap]


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
            if sync.get("active"):
                text = ("I'm still reading and understanding your company from the connected tools "
                        f"(currently: {sync.get('phase', 'reading')}). Ask me again in a moment "
                        "and I'll answer from the full picture.")
                yield _sse({"type": "delta", "text": text})
                citations, grounded = [], False
            else:
                yield _sse({"type": "phase", "phase": "retrieving"})
                prompt, hits, stats = await _build_context(db, ws, question, history)
                grounded = bool(hits or stats)

                if not settings.ai_enabled:
                    text = _fallback_text(stats, hits)
                    yield _sse({"type": "delta", "text": text})
                    citations = _make_cites(hits[:6])
                else:
                    yield _sse({"type": "phase", "phase": "reasoning"})
                    directives = await learning.directives_block(db, ws, question)
                    parts: list[str] = []
                    try:
                        from pydantic_ai import Agent as _Agent
                        from pydantic_ai.messages import (
                            PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta,
                            ThinkingPart, ThinkingPartDelta,
                        )

                        from ..agents.definitions import SYSTEM_PROMPTS, build_text_agent

                        agent = build_text_agent(SYSTEM_PROMPTS["orbit-chat-stream"] + directives, thinking=True)
                        # Event-level iteration so the model's THINKING streams to
                        # the UI separately from the answer (the GPT-style trace).
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
                        text = "".join(parts).strip()
                        if not text:
                            text = _fallback_text(stats, hits)
                            yield _sse({"type": "delta", "text": text})
                    except Exception:
                        logger.warning("orbit-chat stream failed; using fallback", exc_info=True)
                        text = _fallback_text(stats, hits)
                        if not parts:
                            yield _sse({"type": "delta", "text": text})
                    citations = _make_cites(_cites_from_text(text, hits))

            msgs = history
            msgs.append({"role": "user", "content": question, "citations": [], "grounded": True})
            msgs.append({"role": "assistant", "content": text,
                         "citations": [c.model_dump() for c in citations], "grounded": grounded})
            conv.messages = msgs
            conv.updated_at = _now()
            if not conv.title or conv.title == "New chat":
                conv.title = question[:60]
            await db.commit()

            yield _sse({"type": "done", "conversationId": conv.id,
                        "citations": [c.model_dump() for c in citations], "grounded": grounded})
        except Exception:
            logger.warning("chat stream errored", exc_info=True)
            yield _sse({"type": "error", "message": "Something went wrong while answering. Please try again."})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
