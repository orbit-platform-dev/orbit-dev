"""The learning loop — Orbit generates differently because humans corrected it.

At generation time the AI's original sections are frozen into
ExecutionPlan.draft_snapshot. At approval time the (possibly edited) sections
are diffed against that snapshot; each changed field becomes a Feedback row.
Recent corrections are rendered into every generation's context so the next
draft starts from how this team actually writes, not from zero.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from ..models import ExecutionPlan, Feedback

_CLIP = 280
_MAX_CORRECTIONS = 8

# section label → the plan attribute it snapshots
_SECTIONS = {"prd": "prd", "crm-update": "crm_update", "email": "customer_update", "timeline": "timeline"}


def _clip(value) -> str:
    if value is None:
        return ""
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= _CLIP else s[: _CLIP - 1] + "…"


def snapshot_sections(p: ExecutionPlan) -> dict:
    """Freeze what the AI wrote, before any human touches it."""
    return {label: getattr(p, attr) for label, attr in _SECTIONS.items() if getattr(p, attr)}


async def capture_feedback(db, p: ExecutionPlan) -> int:
    """Diff the approved sections against the AI's snapshot → Feedback rows.
    Returns how many corrections were recorded. No snapshot → nothing to learn."""
    snap = p.draft_snapshot or {}
    if not snap:
        return 0
    now = datetime.now(timezone.utc)
    recorded = 0
    for label, attr in _SECTIONS.items():
        before_section = snap.get(label)
        after_section = getattr(p, attr)
        if not isinstance(before_section, dict) or not isinstance(after_section, dict):
            continue
        for field in before_section.keys() | after_section.keys():
            if field in ("skipped", "to"):  # delivery metadata, not writing style
                continue
            before, after = before_section.get(field), after_section.get(field)
            if _clip(before) == _clip(after):
                continue
            db.add(Feedback(
                id=f"fb_{uuid.uuid4().hex[:8]}", workspace_id=p.workspace_id,
                customer_id=p.customer_id, plan_id=p.id, section=label, field=str(field),
                before=_clip(before), after=_clip(after), created_at=now,
            ))
            recorded += 1
    return recorded


async def render_corrections(db, workspace_id: str) -> str:
    """The most recent human corrections as a compact prompt block, or ''
    when there's nothing learned yet."""
    rows = (await db.execute(
        select(Feedback).where(Feedback.workspace_id == workspace_id)
        .order_by(Feedback.created_at.desc()).limit(_MAX_CORRECTIONS))).scalars().all()
    if not rows:
        return ""
    lines = ["LEARNED CORRECTIONS — how humans edited Orbit's recent drafts before approving. "
             "Match these preferences (tone, specificity, structure) instead of repeating the mistakes:"]
    for r in rows:
        lines.append(f"- [{r.section}.{r.field}] they changed: \"{r.before}\" → \"{r.after}\"")
    return "\n".join(lines)
