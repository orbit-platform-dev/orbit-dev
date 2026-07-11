"""Persist a completed pipeline run as the domain rows the UI reads.

Turns agent output (signals/PRD/plans) into a Project (the Proposal) and its
Tasks, each carrying its "why". Re-running for the same meeting replaces its
prior rows so it stays idempotent.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from ..models import ActivityEvent, Customer, Meeting, Project, Task


def _key(name: str) -> str:
    letters = "".join(c for c in name.upper() if c.isalnum())
    return letters[:3] or "ORB"


_PRIORITIES = {"urgent", "high", "medium", "low"}


def _norm_priority(p) -> str:
    p = str(p or "").lower().strip()
    return p if p in _PRIORITIES else "high"


def _map_prd(prd: dict, now: datetime) -> dict:
    return {
        "title": prd.get("title", ""),
        "problem": prd.get("problem", ""),
        "background": prd.get("background", ""),
        "goals": prd.get("goals", []),
        "nonGoals": prd.get("nonGoals", []),
        "functionalRequirements": prd.get("functionalRequirements", []),
        "acceptanceCriteria": prd.get("acceptanceCriteria", []),
        "dependencies": prd.get("dependencies", []),
        "risks": prd.get("risks", []),
        "successMetrics": prd.get("successMetrics", []),
        "userStories": [{"id": f"us_{i}", **s} for i, s in enumerate(prd.get("userStories", []))],
        "sections": [],
        "generatedBy": "product-manager",
        "updatedAt": now.isoformat(),
    }


def _map_engineering(eng: dict) -> dict:
    return {
        "architecture": eng.get("architecture", ""),
        "components": [{"name": c, "description": "", "status": "todo"} for c in eng.get("components", [])],
        "apis": [],
        "risks": [{"risk": r, "mitigation": "", "severity": "medium"} for r in eng.get("risks", [])],
        "estimateWeeks": eng.get("estimateWeeks", 0),
        "techStack": [],
    }


def _map_design(design: dict) -> dict:
    return {
        "summary": design.get("summary", ""),
        "flows": [{"name": f, "steps": []} for f in design.get("flows", [])],
        "screens": [{"name": s, "description": "", "status": "todo"} for s in design.get("screens", [])],
        "principles": [],
        "components": [],
    }


def _map_qa(qa: dict) -> dict:
    return {
        "strategy": qa.get("strategy", ""),
        "testCases": [{"id": f"tc_{i}", "title": t, "type": "manual", "status": "pending"} for i, t in enumerate(qa.get("testCases", []))],
        "coverage": qa.get("coverageEstimate", 0),
        "risks": [],
    }


def _map_sales(sales: dict) -> dict:
    return {
        "positioning": sales.get("positioning", ""),
        "targetSegments": sales.get("targetSegments", []),
        "talkingPoints": sales.get("talkingPoints", []),
        "pricing": [],
        "pipeline": [],
    }


async def delete_execution(meeting_id: str, db) -> None:
    """Remove the tasks, project and their activity derived from a meeting
    (idempotent — also runs before re-analysis, so a replaced project takes its
    activity trail with it)."""
    await db.execute(delete(Task).where(Task.id.like(f"tk_{meeting_id}_%")))
    for p in (await db.execute(select(Project).where(Project.source_meeting_id == meeting_id))).scalars().all():
        await db.execute(delete(ActivityEvent).where(ActivityEvent.project_id == p.id))
        await db.delete(p)
    await db.flush()


async def persist_execution(m: Meeting, state: dict, db) -> str:
    signals = state.get("signals") or {}
    prd = state.get("prd") or {}
    crm = state.get("crm") or {}
    eng = state.get("engineering") or {}
    design = state.get("design") or {}
    qa = state.get("qa") or {}
    sales = state.get("sales") or {}
    cu = state.get("customer_update") or {}
    work_items = (state.get("work_plan") or {}).get("items") or []
    timeline = state.get("timeline") or {}
    now = datetime.now(timezone.utc)
    frs = signals.get("featureRequests") or []
    primary = (prd.get("title") or (frs[0]["title"] if frs else None) or (prd.get("goals") or [m.title])[0])
    weeks = timeline.get("durationWeeks") or eng.get("estimateWeeks") or 6

    # Auto-assign the follow-up recipient from what Orbit learned about this
    # customer (stored when a previous follow-up was sent); editable in review.
    if cu and not cu.get("skipped") and not cu.get("to") and m.customer_id:
        customer = await db.get(Customer, m.customer_id)
        contact = (customer.meta or {}).get("contactEmail") if customer else None
        if contact:
            cu = {**cu, "to": contact}

    await delete_execution(m.id, db)  # replace any prior execution (idempotent re-runs)

    pid = f"p_{uuid.uuid4().hex[:8]}"
    db.add(Project(
        id=pid, name=primary[:60], key=_key(primary), description=(prd.get("problem") or m.title)[:500],
        status="in-progress", health="at-risk" if signals.get("urgency") in ("critical", "high") else "on-track",
        progress=20, start_date=now, target_date=now + timedelta(weeks=weeks),
        delivery_estimate=timeline.get("deliveryEstimate") or f"~{weeks} weeks", source_meeting_id=m.id,
        customer_id=m.customer_id, workspace_id=m.workspace_id or "ws_default",
        revenue_impact=float(signals.get("revenueImpact") or 0),
        owner={"id": "u_1", "name": "You", "email": "", "role": "Owner", "title": "Owner", "status": "active"},
        team=[], tags=m.tags or [], documents=[],
        # PRD is generated on demand (review screen's Generate PRD button), so
        # the human decides when it exists; the pipeline's internal draft above
        # only steered routing and the downstream sections.
        prd=None, crm_update=crm or None,
        engineering=_map_engineering(eng), design=_map_design(design),
        qa=_map_qa(qa), sales=_map_sales(sales),
        customer_update=cu or None, timeline=timeline or None, approval_status="draft",
        # The learning loop's baseline: what the AI wrote before any human edit.
        draft_snapshot={k: v for k, v in
                        {"crm-update": crm or None, "email": cu or None,
                         "timeline": timeline or None}.items() if v},
    ))

    # Work items become tasks across every relevant discipline (not just engineering),
    # each carrying its "why" + confidence so the review screen can explain itself.
    tasks = []
    for i, w in enumerate(work_items, start=1):
        disc = w.get("discipline") or "engineering"
        owner = w.get("suggestedOwner")
        tasks.append(Task(
            id=f"tk_{m.id}_{i}", key=f"{_key(primary)}-{i}", title=(w.get("title") or "Work item")[:140],
            description=w.get("description", ""), column="todo", priority=_norm_priority(w.get("priority")),
            discipline=disc, estimate=w.get("estimatePoints"), project_id=pid,
            assignee={"name": owner, "title": owner, "isSuggested": True} if owner else None,
            labels=[disc], created_at=now, updated_at=now,
            links={"meetingId": m.id,
                   "reason": w.get("reason", ""), "confidence": w.get("confidence")},
        ))
    db.add_all(tasks)
    await db.flush()
    return pid
