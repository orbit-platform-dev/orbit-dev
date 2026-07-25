"""The Act phase — autonomous drafting for human review.

When the heartbeat writes a high-priority finding (gap/drift), it dispatches the
Product Agent here to draft a concrete, reviewable proposal — a PRD update, a
Slack alert, or an action plan — and attaches it to the finding for a human to
approve. This NEVER executes anything: it drafts and stores only, honoring
Orbit's human-in-the-loop invariant and the heartbeat's read/insight-write-only
charter. Degrades to a deterministic template with AI off.

The draft lives on the finding at ``Insight.evidence["proposal"]`` (no migration
needed; the detector's re-scan upsert never overwrites evidence) and is surfaced
to the UI via ``FindingOut.proposal``.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from ..config import settings
from ..models import ActivityEvent, Artifact, Entity, Insight
from . import learning

logger = logging.getLogger("orbit.proposals")

_HIGH_PRIORITY = ("gap", "drift")  # only the risk kinds get an autonomous draft
_MAX_PER_RUN = 3  # bound LLM work per heartbeat tick


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _load_evidence(db, insight: Insight) -> tuple[list[Entity], list[Artifact]]:
    entities, artifacts = [], []
    for eid in insight.entity_ids or []:
        e = await db.get(Entity, eid)
        if e:
            entities.append(e)
    for aid in insight.artifact_ids or []:
        a = await db.get(Artifact, aid)
        if a:
            artifacts.append(a)
    return entities, artifacts


def _fallback_proposal(insight: Insight, entities: list[Entity], artifacts: list[Artifact]) -> dict:
    """Deterministic, no-LLM draft — honest and grounded, never fabricated."""
    kind = "slack-alert" if insight.kind == "drift" else "action-plan"
    parts = [insight.detail or insight.title]
    if entities:
        parts.append("Involves: " + ", ".join(e.name for e in entities[:5]) + ".")
    if artifacts:
        parts.append("Evidence: " + ", ".join(a.title for a in artifacts[:5]) + ".")
    parts.append("Proposed next step: assign an owner and confirm scope before it slips.")
    return {
        "kind": kind,
        "title": f"Proposed action: {insight.title}"[:200],
        "body": "\n\n".join(parts),
        "draftedAt": _now().isoformat(),
        "status": "draft",
    }


async def draft_proposal(db, ws: str, insight: Insight) -> dict:
    """Draft one proposal for a finding. Uses the Product Agent when AI is on
    (with the team's learned directives), a deterministic template otherwise."""
    entities, artifacts = await _load_evidence(db, insight)
    data = _fallback_proposal(insight, entities, artifacts)
    if not settings.ai_enabled:
        return data
    try:
        from ..agents.definitions import SYSTEM_PROMPTS, build_agent
        from ..agents.schemas import DraftedProposal

        directives = await learning.directives_block(db, ws, f"{insight.title} {insight.detail}")
        lines = [f"FINDING [{insight.kind}]: {insight.title}", insight.detail or ""]
        if entities:
            lines.append("ENTITIES: " + "; ".join(f"{e.kind}: {e.name}" for e in entities))
        if artifacts:
            lines.append("WORK ITEMS: " + "; ".join(a.title for a in artifacts))
        agent = build_agent(SYSTEM_PROMPTS["product-agent"] + directives, DraftedProposal)
        out = (await agent.run("\n".join(lines))).output
        return {
            "kind": out.kind or data["kind"],
            "title": (out.title or data["title"])[:200],
            "body": out.body or data["body"],
            "draftedAt": _now().isoformat(),
            "status": "draft",
        }
    except Exception:
        logger.warning("product agent draft failed; using deterministic fallback", exc_info=True)
        return data


async def dispatch_for_workspace(db, ws: str, limit: int = _MAX_PER_RUN) -> int:
    """Draft proposals for high-priority OPEN findings that don't have one yet.

    Bounded per run (LLM cost) and idempotent (skips findings that already carry a
    proposal). Insight-writes only — no external action. Returns the count drafted.
    Runs on the heartbeat's background loop, so it never blocks a user request.
    """
    findings = (
        (
            await db.execute(
                select(Insight)
                .where(
                    Insight.workspace_id == ws,
                    Insight.origin == "model",
                    Insight.status == "open",
                    Insight.kind.in_(_HIGH_PRIORITY),
                )
                .order_by(Insight.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    todo = [f for f in findings if not (f.evidence or {}).get("proposal")][:limit]
    if not todo:
        return 0
    for f in todo:
        proposal = await draft_proposal(db, ws, f)
        f.evidence = {**(f.evidence or {}), "proposal": proposal}  # reassign so JSON change tracks
        db.add(
            ActivityEvent(
                id=f"ac_{uuid.uuid4().hex[:8]}",
                actor={"name": "Orbit Product Agent", "isAgent": True},
                action="drafted",
                target=f"Drafted a proposal for: {f.title}"[:200],
                target_type="finding",
                at=_now(),
            )
        )
    await db.commit()
    logger.info("product agent drafted %d proposal(s) for %s", len(todo), ws)
    return len(todo)
