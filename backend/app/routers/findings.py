"""Feed + findings — Reason, Recommend, Approve, Execute, Learn.

The Feed is the proactive surface: evidence-backed findings, some carrying a
prepared Linear action. Approving a recommendation performs the one real
outbound action (create a Linear issue) and marks the commitment tracked; edits
and dismissals are captured as learning signal. Nothing acts without approval.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select

from ..deps import Depends, get_current_user, get_db
from ..models import ActivityEvent, Artifact, Entity, Feedback, Insight, UserVisit, Workspace
from ..schemas import ArtifactOut, BriefingOut, BriefOut, CorrectionOut, DeltaItemOut, EntityOut, FeedOut, FindingOut
from ..services import heartbeat, learning, memory, scheduler, tickets
from ..services import linear as linear_svc
from ..services.workspace import get_workspace_id

router = APIRouter(tags=["feed"])


async def _auto_sync_enabled(db, ws: str) -> bool:
    row = await db.get(Workspace, ws)
    return bool(row.auto_sync) if row else True


@router.get("/heartbeat")
async def heartbeat_status(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Auto-sync status: whether Orbit is watching, the interval, last run, and
    any immediate sync currently in progress (so the UI can show live progress)."""
    return heartbeat.status(ws, enabled=await _auto_sync_enabled(db, ws))


class AutoSyncIn(BaseModel):
    enabled: bool


@router.post("/heartbeat/auto")
async def set_auto_sync(
    body: AutoSyncIn, db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)
):
    """Toggle auto-sync for this workspace. Persisted — gates the in-process loop
    AND Cloud Scheduler ticks. Manual 'Pull now' works either way. When
    SCHEDULER_JOB is configured (prod), also pauses/resumes the Cloud Scheduler
    job itself, so toggle-off means zero scheduled calls."""
    row = await db.get(Workspace, ws)
    if row:
        row.auto_sync = body.enabled
        await db.commit()
    await scheduler.set_paused(not body.enabled)
    return heartbeat.status(ws, enabled=body.enabled)


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
        id=insight.id,
        kind=insight.kind,
        title=insight.title,
        detail=insight.detail,
        status=insight.status,
        action=insight.action,
        entities=entities,
        artifacts=artifacts,
        proposal=(insight.evidence or {}).get("proposal"),
        created_at=insight.created_at,
    )


_SESSION_GAP_MIN = 30
# Everything open and actionable except `win` (celebration, not action):
# broken promises outrank drift, drift outranks demand signal.
_NEEDS_YOU_KINDS = ("gap", "drift", "trend")
_NEEDS_YOU_CAP = 3


def _utc(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


async def _visit_anchor(db, ws: str, uid: str) -> datetime:
    """The start of 'while you were away'. Advances only when a new session
    begins, so refreshing the Feed never erases the delta. First visit anchors
    to 24h back — 'since yesterday' is an honest first briefing."""
    now = datetime.now(timezone.utc)
    row = await db.get(UserVisit, (ws, uid))
    if row is None:
        anchor = now - timedelta(hours=24)
        db.add(UserVisit(workspace_id=ws, user_id=uid, seen_at=now, anchor_at=anchor))
    else:
        seen = _utc(row.seen_at)
        if seen and (now - seen) > timedelta(minutes=_SESSION_GAP_MIN):
            row.anchor_at = seen
        anchor = _utc(row.anchor_at) or (now - timedelta(hours=24))
        row.seen_at = now
    await db.commit()
    return anchor


async def _stakes_key(db, i: Insight) -> tuple:
    """Rank what needs a human: broken promises first, then anything with a due
    date or a named customer on the promise, newest last as tiebreak."""
    due = to = False
    for eid in i.entity_ids or []:
        e = await db.get(Entity, eid)
        meta = (e.meta or {}) if e else {}
        due = due or bool(meta.get("due"))
        to = to or bool(meta.get("to"))
    kind_w = {"gap": 0, "drift": 1}.get(i.kind, 2)
    ts = i.created_at.timestamp() if i.created_at else 0
    return (kind_w, not due, not to, -ts)


async def _briefing(db, ws: str, uid: str, rows: list[Insight], findings: list[FindingOut]) -> BriefingOut:
    anchor = await _visit_anchor(db, ws, uid)
    by_id = {i.id: f for i, f in zip(rows, findings)}

    candidates = [i for i in rows if i.status == "open" and i.kind in _NEEDS_YOU_KINDS]
    ranked = sorted([(await _stakes_key(db, i), i) for i in candidates], key=lambda t: t[0])
    needs_you = [by_id[i.id] for _, i in ranked[:_NEEDS_YOU_CAP]]

    moved: list[DeltaItemOut] = []
    for i in rows:
        created = _utc(i.created_at)
        if created and created > anchor:
            moved.append(DeltaItemOut(kind="finding", label=f"New {i.kind}: {i.title}", finding_id=i.id))
    ents = (
        (
            await db.execute(
                select(Entity).where(Entity.workspace_id == ws, Entity.kind == "commitment", Entity.updated_at > anchor)
            )
        )
        .scalars()
        .all()
    )
    for c in ents:
        ref = (c.meta or {}).get("work") or (c.meta or {}).get("linear") or {}
        created = _utc(c.created_at)
        if c.state == "delivered":
            moved.append(
                DeltaItemOut(
                    kind="shipped",
                    label=f"Shipped: {c.name}" + (f" ({ref.get('identifier')})" if ref.get("identifier") else ""),
                    url=ref.get("url"),
                )
            )
        elif created and created > anchor:
            to = (c.meta or {}).get("to")
            moved.append(DeltaItemOut(kind="promise", label=f"New promise: {c.name}" + (f" — to {to}" if to else "")))

    counts = (
        (
            await db.execute(
                select(Artifact.source, func.count())
                .where(Artifact.workspace_id == ws, Artifact.created_at > anchor)
                .group_by(Artifact.source)
            )
        )
        .tuples()
        .all()
    )
    return BriefingOut(
        needs_you=needs_you,
        all_clear=not needs_you,
        since=anchor,
        moved=moved[:8],
        watched={src: n for src, n in counts},
    )


@router.get("/feed", response_model=FeedOut)
async def get_feed(db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    rows = (
        (
            await db.execute(
                select(Insight).where(
                    Insight.workspace_id == ws,
                    Insight.origin == "model",
                    Insight.kind != "brief",
                    Insight.status.in_(("open", "approved")),
                )
            )
        )
        .scalars()
        .all()
    )
    rows.sort(
        key=lambda i: (_RANK.get(i.kind, 9), i.status != "open", -(i.created_at.timestamp() if i.created_at else 0))
    )
    findings = [await _to_finding_out(db, i) for i in rows]
    briefing = await _briefing(db, ws, user.get("sub") or "demo_user", rows, findings)

    brief_row = (
        (
            await db.execute(
                select(Insight)
                .where(
                    Insight.workspace_id == ws,
                    Insight.origin == "model",
                    Insight.kind == "brief",
                )
                .order_by(Insight.created_at.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    brief = BriefOut.model_validate(brief_row) if brief_row else None
    return FeedOut(brief=brief, findings=findings, briefing=briefing)


@router.get("/learning", response_model=list[CorrectionOut])
async def list_learning(limit: int = 20, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """What Orbit has learned: the recent human corrections (edits + dismissals)
    that now shape future extraction and recommendations."""
    return (
        (
            await db.execute(
                select(Feedback)
                .where(Feedback.workspace_id == ws)
                .order_by(Feedback.created_at.desc())
                .limit(min(limit, 50))
            )
        )
        .scalars()
        .all()
    )


@router.post("/feed/scan")
async def scan(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Kick off an immediate read + reason now (idempotent). Progress streams via
    GET /heartbeat `sync`, which the Feed renders in place of its empty state.
    No-ops if a scan is already in flight."""
    heartbeat.start_sync(ws, "scan")
    return heartbeat.status(ws, enabled=await _auto_sync_enabled(db, ws))


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


async def _evidence_for_issue(db, f: Insight) -> tuple[str, list[tuple[str, str]]]:
    """The finding's evidence, ready for the created issue: a markdown block to
    append to the description, and (url, title) pairs for native attachments.
    Empty when the finding carries no evidence — the description stays untouched."""
    lines: list[str] = []
    links: list[tuple[str, str]] = []
    for eid in f.entity_ids or []:
        e = await db.get(Entity, eid)
        if e and e.kind == "commitment":
            due = (e.meta or {}).get("due")
            lines.append(f"- Commitment: {e.name}" + (f" (due {due})" if due else ""))
    for aid in f.artifact_ids or []:
        a = await db.get(Artifact, aid)
        if not a:
            continue
        if a.url:
            lines.append(f"- [{a.title}]({a.url})")
            links.append((a.url, a.title))
        else:
            lines.append(f"- {a.title} ({a.source})")
    if not lines:
        return "", []
    return "\n\n---\n**Evidence** (attached by Orbit)\n" + "\n".join(lines), links


@router.post("/findings/{finding_id}/approve", response_model=FindingOut)
async def approve_finding(
    finding_id: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)
):
    """Approve a recommendation: perform its prepared action, then record it.
    Actions: create a Linear issue, or remember an agent-proposed fact."""
    f = await _get_finding(db, ws, finding_id)
    if f.status != "open":
        raise HTTPException(409, "This finding has already been actioned")
    action = f.action or {}

    if action.get("type") == "remember-fact":
        # An MCP agent proposed this fact; approval is the moment it becomes memory.
        mem = await memory.record(
            db,
            ws,
            fact=action.get("title", ""),
            kind="note",
            subject=action.get("subject", ""),
            source_ref=f"MCP agent · approved by {user.get('name', 'a human')}",
            importance=0.7,
            base_confidence=0.85,
        )
        if mem is None:
            raise HTTPException(422, "The proposed fact is empty")
        f.action = {**action, "result": {"memoryId": mem.id}}
        f.status = "approved"
        db.add(
            ActivityEvent(
                id=f"ac_{uuid.uuid4().hex[:8]}",
                actor={"name": user.get("name", "You"), "isAgent": False},
                action="approved",
                target=f"Remembered: {action.get('title', '')[:80]}",
                target_type="finding",
                at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
        return await _to_finding_out(db, f)

    if action.get("type") != "create-linear-issue":
        raise HTTPException(422, "This finding has no action to approve")

    evidence_md, links = await _evidence_for_issue(db, f)
    try:
        result = await tickets.create_ticket(
            db, ws, connector="linear", title=action["title"], description=action.get("description", "") + evidence_md
        )
    except PermissionError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Linear did not create the issue: {exc}") from exc

    if links and result.get("id"):
        auth = await linear_svc.get_auth(db, ws)
        if auth:
            for url, title in links:
                await linear_svc.attach_link(auth, result["id"], url, title)

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
    db.add(
        ActivityEvent(
            id=f"ac_{uuid.uuid4().hex[:8]}",
            actor={"name": user.get("name", "You"), "isAgent": False},
            action="approved",
            target=f"Created {result.get('identifier', 'a Linear issue')}",
            target_type="finding",
            at=datetime.now(timezone.utc),
        )
    )
    await db.commit()
    return await _to_finding_out(db, f)


@router.post("/findings/{finding_id}/edit", response_model=FindingOut)
async def edit_finding(finding_id: str, body: EditFindingIn, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Edit a recommendation's prepared action before approving. The edit is
    captured as learning signal."""
    f = await _get_finding(db, ws, finding_id)
    if f.status != "open":
        raise HTTPException(409, "This finding has already been actioned")
    action = dict(f.action or {})
    if action.get("type") not in ("create-linear-issue", "remember-fact"):
        raise HTTPException(422, "This finding has no editable action")
    for field, key in (("title", "title"), ("description", "description")):
        value = getattr(body, field)
        if value is not None and value != action.get(key, ""):
            # Capture + vectorize the correction (a learned behavioral rule).
            await learning.record_feedback(
                db,
                ws,
                section="finding",
                field=key,
                before=str(action.get(key, "")),
                after=str(value),
                context=f.title,
            )
            action[key] = value
    f.action = action
    await db.commit()
    return await _to_finding_out(db, f)


@router.post("/findings/{finding_id}/dismiss", response_model=FindingOut)
async def dismiss_finding(
    finding_id: str, body: DismissFindingIn, db=Depends(get_db), ws: str = Depends(get_workspace_id)
):
    """Dismiss a finding (a learning signal — this kind surfaces less)."""
    f = await _get_finding(db, ws, finding_id)
    f.status = "dismissed"
    await learning.record_feedback(
        db,
        ws,
        section="finding",
        field="dismiss",
        before=f"[{f.kind}] {f.title}",
        after=(body.reason or ""),
        context=f.title,
    )
    await db.commit()
    return await _to_finding_out(db, f)
