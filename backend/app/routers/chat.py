"""Ask Orbit — the chat surface over the company brain.

Answers are produced by the tool-calling agent in ``agents.orbit_agent``: it thinks,
searches the right company memory with tools, analyzes and answers, citing only the
artifacts it actually fetched. This module owns HTTP, per-user conversation
persistence, and the ticket draft/approve lifecycle. Conversations are scoped to
(workspace_id, user_id) so each person's chat stays private within a shared workspace.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from ..agents import orbit_agent
from ..config import settings
from ..deps import get_current_user, get_db
from ..models import ActivityEvent, ChatConversation
from ..services import github, heartbeat, learning, linear, memory, tickets
from ..services.workspace import get_workspace_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


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
    language: str | None = None


class ChatOut(_Camel):
    conversation_id: str
    answer: str
    citations: list[Citation] = []
    grounded: bool = True
    draft: dict | None = None


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


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _sync_notice(sync: dict) -> str:
    return (
        "I'm still reading and understanding your company from the connected tools "
        f"(currently: {sync.get('phase', 'reading')}). {sync.get('message', '')} "
        "Ask me again in a moment and I'll answer from the full picture."
    ).strip()


async def _owned(db, ws: str, uid: str, cid: str) -> ChatConversation:
    conv = await db.get(ChatConversation, cid)
    if not conv or conv.workspace_id != ws or conv.user_id != uid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conv


async def _get_or_create(db, ws: str, uid: str, cid: str | None, title: str) -> ChatConversation:
    if cid:
        return await _owned(db, ws, uid, cid)
    conv = ChatConversation(
        id=f"conv_{uuid.uuid4().hex[:12]}",
        workspace_id=ws,
        user_id=uid,
        title=title[:60],
        messages=[],
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(conv)
    return conv


def _persist(
    conv: ChatConversation, question: str, text: str, citations: list[dict], grounded: bool, draft: dict | None
) -> None:
    msgs = list(conv.messages or [])
    msgs.append({"role": "user", "content": question, "citations": [], "grounded": True})
    assistant = {"role": "assistant", "content": text, "citations": citations, "grounded": grounded}
    if draft:
        assistant["draft"] = draft
    msgs.append(assistant)
    conv.messages = msgs
    conv.updated_at = _now()
    if not conv.title or conv.title == "New chat":
        conv.title = question[:60]


def _find_action(conv: ChatConversation, action_id: str) -> dict | None:
    for m in conv.messages or []:
        d = m.get("draft")
        if d and d.get("actionId") == action_id:
            return d
    return None


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    rows = (
        (
            await db.execute(
                select(ChatConversation)
                .where(ChatConversation.workspace_id == ws, ChatConversation.user_id == _uid(user))
                .order_by(ChatConversation.updated_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    return [ConversationSummary(id=c.id, title=c.title, updated_at=c.updated_at) for c in rows]


@router.get("/conversations/{cid}", response_model=ConversationDetail)
async def get_conversation(
    cid: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)
):
    conv = await _owned(db, ws, _uid(user), cid)
    return ConversationDetail(id=conv.id, title=conv.title, messages=[Message(**m) for m in (conv.messages or [])])


@router.delete("/conversations/{cid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    cid: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)
):
    conv = await _owned(db, ws, _uid(user), cid)
    await db.delete(conv)
    await db.commit()


@router.post("", response_model=ChatOut)
async def ask(body: ChatIn, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    uid = _uid(user)
    question = (body.message or "").strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required.")
    conv = await _get_or_create(db, ws, uid, body.conversation_id, question)
    history = list(conv.messages or [])
    deps = orbit_agent.ChatDeps(
        db=db, ws=ws, uid=uid, who=user.get("name") or uid, language=(body.language or "").strip()
    )

    citations: list[dict] = []
    draft: dict | None = None
    sync = heartbeat.status(ws).get("sync") or {}
    if sync.get("active"):
        text, grounded = _sync_notice(sync), False
    elif not settings.ai_enabled:
        text, citations = await orbit_agent.keyword_fallback(deps, question)
        grounded = deps.touched
    else:
        try:
            text = await orbit_agent.answer(deps, question, history)
        except Exception:
            logger.warning("agent answer failed; degrading", exc_info=True)
            text, _ = await orbit_agent.keyword_fallback(deps, question)
        citations = await orbit_agent.relevant_citations(deps, text)
        grounded = deps.touched
        draft = deps.staged_drafts[0] if deps.staged_drafts else None

    _persist(conv, question, text, citations, grounded, draft)
    await db.commit()
    return ChatOut(
        conversation_id=conv.id,
        answer=text,
        citations=[Citation(**c) for c in citations],
        grounded=grounded,
        draft=draft,
    )


@router.post("/stream")
async def ask_stream(
    body: ChatIn, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)
):
    uid = _uid(user)
    question = (body.message or "").strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is required.")
    conv = await _get_or_create(db, ws, uid, body.conversation_id, question)
    history = list(conv.messages or [])

    async def gen():
        deps = orbit_agent.ChatDeps(
            db=db, ws=ws, uid=uid, who=user.get("name") or uid, language=(body.language or "").strip()
        )
        try:
            sync = heartbeat.status(ws).get("sync") or {}
            citations: list[dict] = []
            grounded = False
            draft: dict | None = None

            if sync.get("active"):
                text = _sync_notice(sync)
                yield _sse({"type": "delta", "text": text})
            elif not settings.ai_enabled:
                text, citations = await orbit_agent.keyword_fallback(deps, question)
                yield _sse({"type": "delta", "text": text})
                grounded = deps.touched
            else:
                try:
                    async for ev in orbit_agent.stream_events(deps, question, history):
                        yield _sse(ev)
                except Exception:
                    logger.warning("agent stream failed; degrading", exc_info=True)
                text = deps.final_text
                if not text:
                    text, _ = await orbit_agent.keyword_fallback(deps, question)
                    yield _sse({"type": "delta", "text": text})
                citations = await orbit_agent.relevant_citations(deps, text)
                grounded = deps.touched
                for d in deps.staged_drafts:
                    yield _sse({"type": "draft", "draft": d})
                draft = deps.staged_drafts[0] if deps.staged_drafts else None

            _persist(conv, question, text, citations, grounded, draft)
            await db.commit()
            yield _sse(
                {
                    "type": "done",
                    "conversationId": conv.id,
                    "citations": citations,
                    "grounded": grounded,
                    "draft": draft,
                }
            )
        except Exception:
            logger.warning("chat stream errored", exc_info=True)
            yield _sse({"type": "error", "message": "Something went wrong while answering. Please try again."})

    return StreamingResponse(
        gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


class TicketTargets(_Camel):
    linear: list[dict] = []
    github: list[dict] = []


@router.get("/ticket-targets", response_model=TicketTargets)
async def ticket_targets(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
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
async def edit_action(
    cid: str,
    action_id: str,
    body: EditActionIn,
    db=Depends(get_db),
    ws: str = Depends(get_workspace_id),
    user=Depends(get_current_user),
):
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
            await learning.record_feedback(
                db,
                ws,
                section="chat-ticket",
                field=field,
                before=str(draft.get(field, "")),
                after=str(v),
                context=draft.get("title", ""),
            )
            draft[field] = v
    if body.connector in ("linear", "github") and body.connector != draft.get("connector"):
        draft["connector"] = body.connector
        if body.target is None:
            draft["target"], draft["targetLabel"] = await orbit_agent.default_target(db, ws, body.connector)
    if body.target is not None:
        draft["target"] = body.target
        draft["targetLabel"] = body.target_label or body.target
    flag_modified(conv, "messages")
    conv.updated_at = _now()
    await db.commit()
    return draft


@router.post("/conversations/{cid}/actions/{action_id}/approve")
async def approve_action(
    cid: str, action_id: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)
):
    conv = await _owned(db, ws, _uid(user), cid)
    draft = _find_action(conv, action_id)
    if not draft:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    if draft.get("status") != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft has already been actioned")

    connector = draft.get("connector")
    title, description = draft.get("title", ""), draft.get("description", "")
    try:
        result = await tickets.create_ticket(
            db, ws, connector=connector, title=title, description=description, target=draft.get("target")
        )
    except PermissionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{connector} did not create the issue: {exc}") from exc

    draft["status"], draft["result"] = "created", result
    flag_modified(conv, "messages")
    conv.updated_at = _now()
    db.add(
        ActivityEvent(
            id=f"ac_{uuid.uuid4().hex[:8]}",
            actor={"name": user.get("name", "You"), "isAgent": False},
            action="approved",
            target=f"Created {result.get('identifier', 'a ticket')} from chat",
            target_type="chat-ticket",
            at=_now(),
        )
    )
    await db.commit()

    try:
        await tickets.ingest_created(db, ws, connector, result, title, description)
        await db.commit()
    except Exception:
        logger.warning("post-create ingest failed", exc_info=True)
        await db.rollback()

    try:
        await memory.record(
            db,
            ws,
            fact="The team creates tickets in Orbit to track work and requests.",
            kind="preference",
            subject="ticket-habit",
            source_ref="Orbit",
            importance=0.5,
            base_confidence=0.8,
        )
        await db.commit()
    except Exception:
        logger.warning("habit record failed", exc_info=True)
        await db.rollback()

    return {"actionId": action_id, "status": "created", "result": result}


class RateIn(_Camel):
    rating: str


@router.post("/conversations/{cid}/messages/{index}/rate")
async def rate_answer(
    cid: str,
    index: int,
    body: RateIn,
    db=Depends(get_db),
    ws: str = Depends(get_workspace_id),
    user=Depends(get_current_user),
):
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
    question = next((msgs[i].get("content", "") for i in range(index - 1, -1, -1) if msgs[i].get("role") == "user"), "")
    answer = msgs[index].get("content", "")
    try:
        await learning.record_feedback(
            db,
            ws,
            section="chat-answer",
            field="rating",
            before=question[:280],
            after=f"{body.rating}: {answer[:180]}",
            user_id=uid,
        )
    except Exception:
        logger.warning("rating feedback record failed", exc_info=True)
    await db.commit()
    return {"index": index, "rating": body.rating}
