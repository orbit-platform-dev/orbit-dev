"""Ask Orbit — chat over the workspace's approved knowledge, with history.

Conversations persist like Claude/GPT chats: each carries its transcript and a
customer binding, so every later turn automatically retrieves that customer's
context. Every answer is grounded in a ContextPackage from the Context Engine —
the chat never receives raw tables or transcripts, only the same structured,
capped context slice the pipeline generators use (the wide variant).
"""
from __future__ import annotations

import difflib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..agents import definitions as d
from ..agents import fallback as fb
from ..agents import schemas as s
from ..config import settings
from ..context.engine import build_context_package, render_context
from ..deps import Depends, get_current_user, get_db
from ..models import ChatConversation, Customer
from ..services.customers import normalize_name
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/chat", tags=["chat"])

_HISTORY_TURNS = 6  # prior turns fed back to the model for continuity


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ChatIn(_Camel):
    message: str
    customer_id: str | None = None
    conversation_id: str | None = None


class ChatOut(_Camel):
    answer: str
    sources: list[dict] = Field(default_factory=list)
    customer_id: str | None = None
    customer_name: str | None = None
    conversation_id: str | None = None


# Tokens too generic to identify a customer on their own ("Vertex Health"
# should match on "vertex", never on a stray "health" in the question).
_GENERIC_TOKENS = {
    "labs", "lab", "health", "finance", "financial", "group", "team", "company",
    "tech", "technologies", "solutions", "software", "systems", "global", "digital",
}
_MATCH_THRESHOLD = 0.84  # catches typos like "nortwind" → "northwind" (0.94)


def _match_score(message_words: set[str], msg_norm: str, c: Customer) -> float:
    """How strongly the message names this customer: exact phrase = 1.0, else the
    best fuzzy ratio between a distinctive name token and any message word."""
    names = [c.normalized_name, *[normalize_name(a) for a in (c.aliases or [])]]
    best = 0.0
    for name in filter(None, names):
        if f" {name} " in f" {msg_norm} ":
            return 1.0
        for token in name.split():
            if len(token) < 3 or token in _GENERIC_TOKENS:
                continue
            for word in message_words:
                if len(word) < 3:
                    continue
                best = max(best, difflib.SequenceMatcher(None, token, word).ratio())
    return best


async def _match_customer(db, ws: str, message: str) -> Customer | None:
    """Entity linking with typo tolerance: exact phrase, distinctive-token, or
    fuzzy token match ("nortwind" → Northwind Labs). Ambiguity returns None so
    the chat asks instead of guessing wrong."""
    msg_norm = normalize_name(message)
    words = {w for w in msg_norm.split() if len(w) >= 3}
    rows = (await db.execute(select(Customer).where(Customer.workspace_id == ws))).scalars().all()
    if not rows:
        return None
    scored = sorted(((s, c) for c in rows if (s := _match_score(words, msg_norm, c)) >= _MATCH_THRESHOLD),
                    key=lambda t: t[0], reverse=True)
    if scored and (len(scored) == 1 or scored[0][0] - scored[1][0] > 0.05):
        return scored[0][1]
    if not scored and len(rows) == 1:
        return rows[0]  # single-customer workspace: questions are about them
    return None


async def _customer_names(db, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = (await db.execute(select(Customer).where(Customer.id.in_(ids)))).scalars().all()
    return {c.id: c.name for c in rows}


# --- Conversation history -------------------------------------------------------
@router.get("/conversations")
async def list_conversations(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    rows = (await db.execute(
        select(ChatConversation).where(ChatConversation.workspace_id == ws)
        .order_by(ChatConversation.updated_at.desc()).limit(50))).scalars().all()
    names = await _customer_names(db, {r.customer_id for r in rows if r.customer_id})
    return [{
        "id": r.id, "title": r.title, "customerId": r.customer_id,
        "customerName": names.get(r.customer_id) if r.customer_id else None,
        "updatedAt": r.updated_at, "messageCount": len(r.messages or []),
    } for r in rows]


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    r = await db.get(ChatConversation, conversation_id)
    if not r:
        raise HTTPException(404, "Conversation not found")
    name = (await _customer_names(db, {r.customer_id})).get(r.customer_id) if r.customer_id else None
    return {"id": r.id, "title": r.title, "customerId": r.customer_id,
            "customerName": name, "messages": r.messages or []}


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    r = await db.get(ChatConversation, conversation_id)
    if r:
        await db.delete(r)
        await db.commit()


# --- Ask ------------------------------------------------------------------------
@router.post("", response_model=ChatOut)
async def chat(body: ChatIn, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    conv = await db.get(ChatConversation, body.conversation_id) if body.conversation_id else None

    customer = await db.get(Customer, body.customer_id) if body.customer_id else None
    if not customer and conv and conv.customer_id:
        customer = await db.get(Customer, conv.customer_id)
    if not customer:
        customer = await _match_customer(db, ws, body.message)
    if not customer:
        names = [c.name for c in (await db.execute(
            select(Customer).where(Customer.workspace_id == ws))).scalars().all()]
        listing = ", ".join(sorted(names)[:8]) if names else "none yet — analyze a meeting first"
        return ChatOut(answer="Which customer are you asking about? I know: " + listing + ".",
                       sources=[], conversation_id=conv.id if conv else None)

    # Chat gets the WIDE context slice — a human question may reach far back
    # into the account history (semantic retrieval finds the right meetings).
    pkg = await build_context_package(db, customer.id, query_text=body.message, wide=True)
    context_text = render_context(pkg)
    prior = (conv.messages or [])[-_HISTORY_TURNS:] if conv else []

    answer, sources = "", []
    if settings.ai_enabled:
        try:
            history = "\n".join(f"{t.get('role', 'user')}: {t.get('content', '')}" for t in prior)
            agent = d.build_agent(d.SYSTEM_PROMPTS["orbit-chat"], s.ChatAnswer)
            result = await agent.run(
                f"{context_text}\n\nConversation so far:\n{history}\n\nQuestion: {body.message}")
            out = result.output.model_dump(by_alias=True)
            answer, sources = out.get("answer", ""), out.get("sources", [])
        except Exception:
            pass  # degrade to the deterministic answer below
    if not answer:
        out = fb.fallback_chat(body.message, context_text)
        answer = out["answer"]
        sources = out.get("sources") or [
            {"type": "meeting", "id": m.id, "title": m.title}
            for m in (pkg.recent_meetings if pkg else [])[:3]]

    now = datetime.now(timezone.utc)
    if not conv:
        conv = ChatConversation(
            id=f"ch_{uuid.uuid4().hex[:8]}", workspace_id=ws, customer_id=customer.id,
            title=body.message.strip()[:60], messages=[], created_at=now, updated_at=now,
        )
        db.add(conv)
    if not conv.customer_id:
        conv.customer_id = customer.id
    conv.messages = [*(conv.messages or []),
                     {"role": "user", "content": body.message, "at": now.isoformat()},
                     {"role": "assistant", "content": answer, "sources": sources, "at": now.isoformat()}]
    conv.updated_at = now
    await db.commit()

    return ChatOut(answer=answer, sources=sources, customer_id=customer.id,
                   customer_name=customer.name, conversation_id=conv.id)
