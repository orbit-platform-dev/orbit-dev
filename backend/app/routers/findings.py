"""Feed + findings — Reason, Recommend, Approve, Execute, Learn.

The Feed is the proactive surface: evidence-backed findings, some carrying a
prepared Linear action. Approving a recommendation performs the one real
outbound action (create a Linear issue) and marks the commitment tracked; edits
and dismissals are captured as learning signal. Nothing acts without approval.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import ActivityEvent, Artifact, Entity, Feedback, Insight
from ..schemas import ArtifactOut, BriefOut, CorrectionOut, EntityOut, FeedOut, FindingOut
from ..services import heartbeat, learning, tickets
from ..services.workspace import get_workspace_id

router = APIRouter(tags=["feed"])


@router.get("/heartbeat")
async def heartbeat_status(ws: str = Depends(get_workspace_id)):
    """Auto-sync status: whether Orbit is watching, the interval, last run, and
    any immediate sync currently in progress (so the UI can show live progress)."""
    return heartbeat.status(ws)


class AutoSyncIn(BaseModel):
    enabled: bool


@router.post("/heartbeat/auto")
async def set_auto_sync(body: AutoSyncIn, ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    """Toggle auto-sync (the heartbeat) on/off. Manual 'Pull now' works either way."""
    heartbeat.set_enabled(body.enabled)
    return heartbeat.status(ws)

_RANK = {"gap": 0, "drift": 1, "win": 2, "trend": 3}


async def _to_finding_out(db, insight: Insight) -> FindingOut:
    entities = []
    for eid in insight.entity_ids or []:
        e = await db.get(Entity, eid)
        if e:
            entities.append(EntityOut.model_validate(e))
    artifacts = []
    for aid in insight.artifact_ids or []:
        a = await db.get(Artifact, aid)
        if a:
            artifacts.append(ArtifactOut.model_validate(a))
    return FindingOut(
        id=insight.id, kind=insight.kind, title=insight.title, detail=insight.detail,
        status=insight.status, action=insight.action, entities=entities, artifacts=artifacts,
        proposal=(insight.evidence or {}).get("proposal"),
        created_at=insight.created_at,
    )


@router.get("/feed", response_model=FeedOut)
async def get_feed(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    rows = (await db.execute(select(Insight).where(
        Insight.workspace_id == ws, Insight.origin == "model",
        Insight.kind != "brief", Insight.status.in_(("open", "approved")),
    ))).scalars().all()
    rows.sort(key=lambda i: (_RANK.get(i.kind, 9), i.status != "open",
                             -(i.created_at.timestamp() if i.created_at else 0)))
    findings = [await _to_finding_out(db, i) for i in rows]

    brief_row = (await db.execute(select(Insight).where(
        Insight.workspace_id == ws, Insight.origin == "model", Insight.kind == "brief",
    ).order_by(Insight.created_at.desc()).limit(1))).scalars().first()
    brief = BriefOut.model_validate(brief_row) if brief_row else None
    return FeedOut(brief=brief, findings=findings)


@router.get("/learning", response_model=list[CorrectionOut])
async def learning(limit: int = 20, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """What Orbit has learned: the recent human corrections (edits + dismissals)
    that now shape future extraction and recommendations."""
    return (await db.execute(select(Feedback).where(Feedback.workspace_id == ws)
            .order_by(Feedback.created_at.desc()).limit(min(limit, 50)))).scalars().all()


@router.post("/feed/scan")
async def scan(ws: str = Depends(get_workspace_id)):
    """Kick off an immediate read + reason now (idempotent). Progress streams via
    GET /heartbeat `sync`, which the Feed renders in place of its empty state.
    No-ops if a scan is already in flight."""
    heartbeat.start_sync(ws, "scan")
    return heartbeat.status(ws)


class EditFindingIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    title: str | None = None
    description: str | None = None


class DismissFindingIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    reason: str = ""


async def _get_finding(db, ws: str, finding_id: str) -> Insight:
    f = await db.get(Insight, finding_id)
    if not f or f.workspace_id != ws or f.origin != "model":
        raise HTTPException(404, "Finding not found")
    return f


@router.post("/findings/{finding_id}/approve", response_model=FindingOut)
async def approve_finding(finding_id: str, db=Depends(get_db), ws: str = Depends(get_workspace_id),
                          user=Depends(get_current_user)):
    """Approve a recommendation: perform its prepared action, then record it.
    Today the only real action is creating a Linear issue."""
    f = await _get_finding(db, ws, finding_id)
    if f.status != "open":
        raise HTTPException(409, "This finding has already been actioned")
    action = f.action or {}
    if action.get("type") != "create-linear-issue":
        raise HTTPException(422, "This finding has no action to approve")

    try:
        result = await tickets.create_ticket(db, ws, connector="linear",
                                             title=action["title"], description=action.get("description", ""))
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Linear did not create the issue: {exc}") from exc

    f.action = {**action, "result": result}
    f.status = "approved"
    # Mark the linked commitment tracked immediately (the issue is ingested +
    # linked on the next Linear pull).
    for eid in f.entity_ids or []:
        e = await db.get(Entity, eid)
        if e and e.kind == "commitment":
            e.state = "tracked"
            e.meta = {**(e.meta or {}), "linear": result}
            e.updated_at = datetime.now(timezone.utc)
    db.add(ActivityEvent(
        id=f"ac_{uuid.uuid4().hex[:8]}",
        actor={"name": user.get("name", "You"), "isAgent": False}, action="approved",
        target=f"Created {result.get('identifier', 'a Linear issue')}",
        target_type="finding", at=datetime.now(timezone.utc),
    ))
    await db.commit()
    return await _to_finding_out(db, f)


@router.post("/findings/{finding_id}/edit", response_model=FindingOut)
async def edit_finding(finding_id: str, body: EditFindingIn, db=Depends(get_db),
                       ws: str = Depends(get_workspace_id)):
    """Edit a recommendation's prepared action before approving. The edit is
    captured as learning signal."""
    f = await _get_finding(db, ws, finding_id)
    if f.status != "open":
        raise HTTPException(409, "This finding has already been actioned")
    action = dict(f.action or {})
    if action.get("type") != "create-linear-issue":
        raise HTTPException(422, "This finding has no editable action")
    for field, key in (("title", "title"), ("description", "description")):
        value = getattr(body, field)
        if value is not None and value != action.get(key, ""):
            # Capture + vectorize the correction (a learned behavioral rule).
            await learning.record_feedback(
                db, ws, section="finding", field=key,
                before=str(action.get(key, "")), after=str(value), context=f.title,
            )
            action[key] = value
    f.action = action
    await db.commit()
    return await _to_finding_out(db, f)


@router.post("/findings/{finding_id}/dismiss", response_model=FindingOut)
async def dismiss_finding(finding_id: str, body: DismissFindingIn, db=Depends(get_db),
                          ws: str = Depends(get_workspace_id)):
    """Dismiss a finding (a learning signal — this kind surfaces less)."""
    f = await _get_finding(db, ws, finding_id)
    f.status = "dismissed"
    await learning.record_feedback(
        db, ws, section="finding", field="dismiss",
        before=f"[{f.kind}] {f.title}", after=(body.reason or ""), context=f.title,
    )
    await db.commit()
    return await _to_finding_out(db, f)
