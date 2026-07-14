"""Ask Orbit — the reasoning layer over company memory, with private per-user
conversation history.

Retrieval is workspace-scoped (semantic when AI is on, keyword+recency else) so
answers see the whole company. Conversations are scoped to (workspace_id,
user_id) so each person's chat is private, even within a shared workspace.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..config import settings
from ..deps import get_current_user, get_db
from ..models import Artifact, ChatConversation, Goal, Insight
from ..services import embeddings
from ..services.workspace import get_workspace_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])

_TOP_K = 8
_MAX_SCAN = 200
_EMBED_CHUNK = 16


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
    rows = (
        await db.execute(
            select(Artifact).where(Artifact.workspace_id == ws).order_by(Artifact.occurred_at.desc()).limit(_MAX_SCAN)
        )
    ).scalars().all()
    if not rows:
        return []
    if embeddings.available():
        missing = [a for a in rows if not a.embedding]
        for i in range(0, len(missing), _EMBED_CHUNK):
            chunk = missing[i : i + _EMBED_CHUNK]
            vals = await embeddings.embed_many([f"{a.title}\n{(a.content or '')[:2000]}" for a in chunk])
            for a, v in zip(chunk, vals):
                if v:
                    a.embedding = v
        if missing:
            await db.flush()
        qv = await embeddings.embed_query(question)
        if qv:
            scored = [(embeddings.cosine(qv, a.embedding), a) for a in rows if a.embedding]
            scored.sort(key=lambda x: x[0], reverse=True)
            return [a for _, a in scored[:k]]
    q = _toks(question)
    ranked = sorted(rows, key=lambda a: (len(q & _toks(f"{a.title} {a.content or ''}")), a.occurred_at), reverse=True)
    return ranked[:k]


async def _answer(db, ws: str, question: str) -> tuple[str, list[Citation], bool]:
    hits = await _retrieve(db, ws, question)
    make_cites = lambda arts: [Citation(id=a.id, source=a.source, title=a.title, url=a.url) for a in arts]

    if not settings.ai_enabled:
        if not hits:
            return ("I don't have any company memory yet. Connect a tool or add a signal and I'll start learning.", [], False)
        lines = "\n".join(f"- {a.title}" for a in hits[:6])
        return (f"Here's the most relevant company memory I found:\n\n{lines}", make_cites(hits[:6]), True)

    insights = (
        await db.execute(
            select(Insight)
            .where(Insight.workspace_id == ws, Insight.status == "open", Insight.kind != "brief")
            .order_by(Insight.created_at.desc())
            .limit(10)
        )
    ).scalars().all()
    goals = (await db.execute(select(Goal).where(Goal.workspace_id == ws, Goal.status == "open").limit(10))).scalars().all()

    snapshot = ""
    if goals:
        snapshot += "GOALS:\n" + "\n".join(f"- {g.title}" for g in goals) + "\n\n"
    if insights:
        snapshot += "OPEN SIGNALS:\n" + "\n".join(f"- [{i.kind}] {i.title}" for i in insights) + "\n\n"
    evidence = (
        "EVIDENCE:\n" + "\n\n".join(f"[id: {a.id}] ({a.source}) {a.title}\n{(a.content or '')[:800]}" for a in hits)
        if hits
        else "EVIDENCE: (nothing relevant found in memory)"
    )
    prompt = f"QUESTION: {question}\n\n{snapshot}{evidence}"

    answer = "Here's the most relevant memory:\n" + "\n".join(f"- {a.title}" for a in hits[:6])
    grounded = bool(hits)
    used = [a.id for a in hits[:3]]
    try:
        from ..agents.definitions import SYSTEM_PROMPTS, build_agent
        from ..agents.schemas import ChatAnswer

        out = (await build_agent(SYSTEM_PROMPTS["orbit-chat"], ChatAnswer).run(prompt)).output
        answer, grounded = out.answer, out.grounded
        valid = {a.id for a in hits}
        used = [cid for cid in out.citation_ids if cid in valid]
    except Exception:
        logger.warning("orbit-chat failed; using fallback", exc_info=True)

    by_id = {a.id: a for a in hits}
    return (answer, make_cites([by_id[c] for c in used if c in by_id]), grounded)


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

    answer, citations, grounded = await _answer(db, ws, question)

    msgs = list(conv.messages or [])
    msgs.append({"role": "user", "content": question, "citations": [], "grounded": True})
    msgs.append({"role": "assistant", "content": answer, "citations": [c.model_dump() for c in citations], "grounded": grounded})
    conv.messages = msgs  # reassign so the JSON column change is tracked
    conv.updated_at = _now()
    if not conv.title or conv.title == "New chat":
        conv.title = question[:60]
    await db.commit()

    return ChatOut(conversation_id=conv.id, answer=answer, citations=citations, grounded=grounded)
