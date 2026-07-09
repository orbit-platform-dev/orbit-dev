"""Customer knowledge writer.

Knowledge is written at exactly one moment: approval. Raw AI output is never
stored as truth — only the human-reviewed, approved sections of an execution
plan (plus the reviewed meeting intent) become KnowledgeItems. Commitments from
the approved follow-up email are tracked individually as open commitments.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from ..models import ExecutionPlan, KnowledgeItem, Meeting
from .embeddings import embed_many


def _item(ws: str, customer_id: str, kind: str, title: str, content: dict,
          m: Meeting, p: ExecutionPlan, now: datetime, status: str = "active") -> KnowledgeItem:
    return KnowledgeItem(
        id=f"k_{uuid.uuid4().hex[:8]}", workspace_id=ws, customer_id=customer_id,
        kind=kind, title=title[:140], content=content, status=status,
        source_meeting_id=m.id, source_plan_id=p.id, approved_at=now, created_at=now,
    )


def _embed_source(item: KnowledgeItem) -> str:
    parts = [f"[{item.kind}] {item.title}"]
    parts += [str(v) for v in item.content.values() if isinstance(v, str) and v]
    return "\n".join(parts)[:2000]


def _skipped(section: dict | None) -> bool:
    return not section or bool(section.get("skipped"))


async def record_approved_plan(db, m: Meeting, p: ExecutionPlan) -> list[str]:
    """Snapshot the approved plan into the customer's knowledge. Returns the
    section keys that were recorded (also stored on the Approval row)."""
    if not m.customer_id:
        return []
    ws, cid = p.workspace_id, m.customer_id
    now = datetime.now(timezone.utc)
    recorded: list[str] = []
    items: list[KnowledgeItem] = []

    analysis = m.analysis or {}
    items.append(_item(ws, cid, "meeting-summary", m.title, {
        "summary": analysis.get("summary", ""),
        "keyTakeaways": analysis.get("keyTakeaways", []),
        "featureRequests": [f.get("title", "") for f in analysis.get("featureRequests", [])],
        "painPoints": [pp.get("title", "") for pp in analysis.get("painPoints", [])],
        "urgency": analysis.get("urgency"),
        "meetingDate": m.date.isoformat() if m.date else None,
    }, m, p, now))
    recorded.append("customer-intent")

    if not _skipped(p.crm_update):
        items.append(_item(ws, cid, "crm-update", f"CRM update — {p.name}", p.crm_update, m, p, now))
        recorded.append("crm-update")
    if p.prd:
        items.append(_item(ws, cid, "prd", p.prd.get("title") or p.name, {
            "title": p.prd.get("title"), "problem": p.prd.get("problem"),
            "goals": p.prd.get("goals", []), "planId": p.id,
        }, m, p, now))
        recorded.append("prd")
    if p.timeline:
        items.append(_item(ws, cid, "timeline", f"Timeline — {p.name}", {
            "deliveryEstimate": p.timeline.get("deliveryEstimate"),
            "durationWeeks": p.timeline.get("durationWeeks"),
            "milestones": p.timeline.get("milestones", []),
        }, m, p, now))
        recorded.append("timeline")
    if not _skipped(p.customer_update):
        items.append(_item(ws, cid, "follow-up-email", p.customer_update.get("subject") or "Follow-up",
                     {"subject": p.customer_update.get("subject"), "body": p.customer_update.get("body")},
                     m, p, now))
        recorded.append("follow-up-email")
        for text in p.customer_update.get("commitments", []):
            items.append(_item(ws, cid, "commitment", text, {"text": text, "madeAt": now.isoformat(),
                                                       "meetingTitle": m.title}, m, p, now, status="open"))
        if p.customer_update.get("commitments"):
            recorded.append("commitments")

    # Embed each item so the Context Engine can retrieve it semantically.
    for item, vec in zip(items, await embed_many([_embed_source(i) for i in items])):
        item.embedding = vec
    db.add_all(items)
    await db.flush()
    return recorded
