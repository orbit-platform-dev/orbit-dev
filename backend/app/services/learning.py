"""The learning loop — Orbit generates differently because humans corrected it.

Human edits and dismissals are captured as Feedback (see routers/findings.py).
Recent corrections are rendered into every generation's context (Extractor,
Reasoner) so the next draft starts from how this team actually works.
"""
from __future__ import annotations

from sqlalchemy import select

from ..models import Feedback

_MAX_CORRECTIONS = 8


async def render_corrections(db, workspace_id: str) -> str:
    """The most recent human corrections as a compact prompt block, or '' when
    there's nothing learned yet."""
    rows = (await db.execute(
        select(Feedback).where(Feedback.workspace_id == workspace_id)
        .order_by(Feedback.created_at.desc()).limit(_MAX_CORRECTIONS))).scalars().all()
    if not rows:
        return ""
    lines = ["LEARNED CORRECTIONS — how humans edited or dismissed Orbit's recent output. "
             "Match these preferences (tone, specificity, what's worth surfacing):"]
    for r in rows:
        lines.append(f"- [{r.section}.{r.field}] \"{r.before}\" → \"{r.after}\"")
    return "\n".join(lines)
