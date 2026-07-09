"""Context Engine.

Builds one structured ContextPackage per generation: the relevant slice of what
Orbit already knows about a customer — never a database dump. Every AI generator
(the whole pipeline AND chat) consumes the same package, so context behavior is
defined in exactly one place.

Retrieval is hybrid:
- Structured facts (open commitments, approved plans) are plain indexed SQL.
- Unstructured recall (which of N past meetings matter for THIS conversation)
  is semantic: pgvector cosine search in-database on Postgres — scales to
  thousands of meetings per customer — with a Python-cosine fallback on dev
  SQLite, and keyword-overlap ranking when embeddings are unavailable.
Everything is hard-capped per source and truncated per field so the rendered
block stays within a small token budget.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select

from ..models import Customer, ExecutionPlan, KnowledgeItem, Meeting
from ..services import embeddings

# Default caps keep pipeline prompts lean; chat asks for the wide set because a
# human question may reach far back into the account history.
_CAPS = {
    "default": {"meetings": 5, "plans": 5, "commitments": 10, "knowledge": 6},
    "wide": {"meetings": 12, "plans": 8, "commitments": 20, "knowledge": 15},
}
_RECENCY_WINDOW = 200  # SQLite/keyword paths never load more than this many rows
_SNIPPET = 240


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ContextMeeting(_Camel):
    id: str
    title: str
    date: str | None = None
    summary: str = ""
    key_takeaways: list[str] = Field(default_factory=list)
    urgency: str | None = None


class ContextPlan(_Camel):
    id: str
    name: str
    approved_at: str | None = None
    prd_title: str | None = None
    delivery_estimate: str | None = None
    status: str = ""


class ContextCommitment(_Camel):
    id: str
    text: str
    made_at: str | None = None
    status: str = "open"


class ContextKnowledge(_Camel):
    id: str
    kind: str
    title: str
    snippet: str = ""
    approved_at: str | None = None


class ContextPackage(_Camel):
    """The single structured context object every generator consumes."""

    customer_id: str
    customer_name: str
    domains: list[str] = Field(default_factory=list)
    meeting_count: int = 0
    first_seen: str | None = None
    recent_meetings: list[ContextMeeting] = Field(default_factory=list)
    approved_plans: list[ContextPlan] = Field(default_factory=list)
    open_commitments: list[ContextCommitment] = Field(default_factory=list)
    recent_knowledge: list[ContextKnowledge] = Field(default_factory=list)
    generated_at: str = ""


def _tokens(text: str) -> set[str]:
    return {w for w in "".join(c if c.isalnum() else " " for c in (text or "").lower()).split() if len(w) > 3}


def _clip(s: str | None, n: int = _SNIPPET) -> str:
    s = s or ""
    return s if len(s) <= n else s[: n - 1] + "…"


async def _semantic_ids(db, base, order_recent, qvec: list[float], k: int) -> list[str]:
    """Top-k semantically similar rows for any embedded model. On Postgres this
    is an indexed pgvector search over the FULL history; on SQLite, Python
    cosine over a bounded recency window."""
    if db.get_bind().dialect.name == "postgresql":
        entity = base.column_descriptions[0]["entity"]
        rows = (await db.execute(
            base.order_by(entity.embedding.cosine_distance(qvec)).limit(k))).scalars().all()
        return [r.id for r in rows]
    rows = (await db.execute(base.order_by(order_recent).limit(_RECENCY_WINDOW))).scalars().all()
    scored = sorted(rows, key=lambda r: embeddings.cosine(qvec, r.embedding), reverse=True)
    return [r.id for r in scored[:k]]


async def _semantic_meeting_ids(db, customer_id: str, exclude_id: str | None,
                                qvec: list[float], k: int) -> list[str]:
    base = select(Meeting).where(Meeting.customer_id == customer_id,
                                 Meeting.embedding.is_not(None))
    if exclude_id:
        base = base.where(Meeting.id != exclude_id)
    return await _semantic_ids(db, base, Meeting.date.desc(), qvec, k)


async def _semantic_knowledge_ids(db, customer_id: str, qvec: list[float], k: int) -> list[str]:
    base = select(KnowledgeItem).where(KnowledgeItem.customer_id == customer_id,
                                       KnowledgeItem.kind != "commitment",
                                       KnowledgeItem.embedding.is_not(None))
    return await _semantic_ids(db, base, KnowledgeItem.created_at.desc(), qvec, k)


async def build_context_package(
    db, customer_id: str, *, exclude_meeting_id: str | None = None, query_text: str | None = None,
    wide: bool = False,
) -> ContextPackage | None:
    """Assemble the relevant customer context. Returns None for unknown customers.
    `wide=True` (chat) retrieves a larger slice of the account history."""
    customer: Customer | None = await db.get(Customer, customer_id)
    if not customer:
        return None
    caps = _CAPS["wide" if wide else "default"]

    meeting_count = (await db.execute(
        select(func.count()).select_from(Meeting).where(Meeting.customer_id == customer_id)
    )).scalar_one()
    first_seen = (await db.execute(
        select(func.min(Meeting.date)).where(Meeting.customer_id == customer_id))).scalar_one()

    # Recency window — bounded, never the whole table.
    recent_q = select(Meeting).where(Meeting.customer_id == customer_id)
    if exclude_meeting_id:
        recent_q = recent_q.where(Meeting.id != exclude_meeting_id)
    history = (await db.execute(
        recent_q.order_by(Meeting.date.desc()).limit(_RECENCY_WINDOW))).scalars().all()
    by_id = {m.id: m for m in history}

    # Semantic ranking when possible; keyword overlap otherwise; recency always
    # backfills so a first meeting with no matches still yields fresh history.
    picked: list[Meeting] = []
    qvec = await embeddings.embed_query(query_text) if query_text else None
    if qvec is not None:
        for mid in await _semantic_meeting_ids(db, customer_id, exclude_meeting_id, qvec, caps["meetings"]):
            m = by_id.get(mid) or await db.get(Meeting, mid)
            if m:
                picked.append(m)
    elif query_text:
        query_tokens = _tokens(query_text)

        def _score(m: Meeting) -> int:
            a = m.analysis or {}
            text = " ".join([a.get("summary", ""), " ".join(a.get("keyTakeaways", [])), m.title])
            return len(query_tokens & _tokens(text))

        picked = sorted(history, key=lambda m: (_score(m), m.date or datetime.min.replace(tzinfo=timezone.utc)),
                        reverse=True)[:caps["meetings"]]
    seen = {m.id for m in picked}
    picked += [m for m in history if m.id not in seen][: caps["meetings"] - len(picked)]

    recent = [
        ContextMeeting(
            id=m.id, title=m.title, date=m.date.isoformat() if m.date else None,
            summary=_clip((m.analysis or {}).get("summary")),
            key_takeaways=[_clip(k, 120) for k in (m.analysis or {}).get("keyTakeaways", [])[:3]],
            urgency=(m.analysis or {}).get("urgency"),
        )
        for m in picked
    ]

    plans = (await db.execute(
        select(ExecutionPlan)
        .where(ExecutionPlan.customer_id == customer_id, ExecutionPlan.approval_status == "approved")
        .order_by(ExecutionPlan.approved_at.desc()).limit(caps["plans"])
    )).scalars().all()
    approved = [
        ContextPlan(
            id=p.id, name=p.name, approved_at=p.approved_at.isoformat() if p.approved_at else None,
            prd_title=(p.prd or {}).get("title"), delivery_estimate=p.delivery_estimate, status=p.status,
        )
        for p in plans
    ]

    commitments = [
        ContextCommitment(id=k.id, text=_clip(k.title, 160),
                          made_at=k.approved_at.isoformat() if k.approved_at else None, status=k.status)
        for k in (await db.execute(
            select(KnowledgeItem).where(KnowledgeItem.customer_id == customer_id,
                                        KnowledgeItem.kind == "commitment",
                                        KnowledgeItem.status == "open")
            .order_by(KnowledgeItem.created_at.desc()).limit(caps["commitments"]))).scalars().all()
    ]
    def _kn(k: KnowledgeItem) -> ContextKnowledge:
        snippet = next((v for v in (k.content or {}).values() if isinstance(v, str) and v), "")
        return ContextKnowledge(id=k.id, kind=k.kind, title=_clip(k.title, 120),
                                snippet=_clip(snippet, 160),
                                approved_at=k.approved_at.isoformat() if k.approved_at else None)

    # Knowledge recall is semantic too (same pattern as meetings): the most
    # MEANINGFUL approved artifacts for this generation, recency as backfill.
    kn_picked: list[KnowledgeItem] = []
    if qvec is not None:
        for kid in await _semantic_knowledge_ids(db, customer_id, qvec, caps["knowledge"]):
            item = await db.get(KnowledgeItem, kid)
            if item:
                kn_picked.append(item)
    kn_seen = {k.id for k in kn_picked}
    kn_picked += [k for k in (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.customer_id == customer_id,
                                    KnowledgeItem.kind != "commitment")
        .order_by(KnowledgeItem.created_at.desc()).limit(caps["knowledge"]))).scalars().all()
        if k.id not in kn_seen][: caps["knowledge"] - len(kn_picked)]
    knowledge = [_kn(k) for k in kn_picked]

    return ContextPackage(
        customer_id=customer.id, customer_name=customer.name, domains=customer.domains or [],
        meeting_count=meeting_count,
        first_seen=first_seen.isoformat() if first_seen else None,
        recent_meetings=recent, approved_plans=approved,
        open_commitments=commitments, recent_knowledge=knowledge,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def render_context(pkg: ContextPackage | None) -> str:
    """Compact prompt block. Empty string when there's no history — generators
    must behave identically to a first meeting in that case."""
    if pkg is None:
        return ""
    lines: list[str] = [f"COMPANY CONTEXT for {pkg.customer_name} "
                        f"({pkg.meeting_count} meetings on record):"]
    if pkg.recent_meetings:
        lines.append("Previous meetings:")
        for m in pkg.recent_meetings:
            date = (m.date or "")[:10]
            lines.append(f"- [{date}] {m.title}: {m.summary}")
    if pkg.approved_plans:
        lines.append("Approved execution plans:")
        for p in pkg.approved_plans:
            lines.append(f"- {p.name} (PRD: {p.prd_title or 'n/a'}, {p.delivery_estimate or ''},"
                         f" approved {(p.approved_at or '')[:10]})")
    if pkg.open_commitments:
        lines.append("Open commitments to this customer:")
        for c in pkg.open_commitments:
            lines.append(f"- {c.text} (since {(c.made_at or '')[:10]})")
    if pkg.recent_knowledge:
        lines.append("Other approved knowledge:")
        for k in pkg.recent_knowledge:
            lines.append(f"- [{k.kind}] {k.title}" + (f" — {k.snippet}" if k.snippet else ""))
    lines.append("Use this history: reference prior asks, avoid re-committing to things already "
                 "delivered, and flag anything the customer has raised repeatedly.")
    return "\n".join(lines)
