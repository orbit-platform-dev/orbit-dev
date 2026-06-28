"""Persist a completed pipeline run as the domain rows the UI reads.

Turns agent output (signals/PRD/plans) into a Project, an execution graph
(GraphNodes + GraphEdges: Meeting -> Need -> PRD -> Eng/Design/Sales -> QA ->
Follow-up), and engineering Tasks. Re-running for the same meeting replaces its
prior rows so it stays idempotent.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from ..models import GraphEdge, GraphNode, Meeting, Project, Task


def _key(name: str) -> str:
    letters = "".join(c for c in name.upper() if c.isalnum())
    return letters[:3] or "ORB"


def _map_prd(prd: dict, now: datetime) -> dict:
    return {
        "problem": prd.get("problem", ""),
        "goals": prd.get("goals", []),
        "nonGoals": prd.get("nonGoals", []),
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


def _node(nid: str, kind: str, title: str, subtitle: str, agent: str, project_id: str, now: datetime,
          *, skipped: bool = False, reason: str = "") -> GraphNode:
    # `reason` is the per-meeting "why" Orbit shows on every node; skipped teams keep it too.
    meta: dict = {}
    if reason:
        meta["reason"] = reason
    if skipped:
        meta["skipped"] = True
    return GraphNode(
        id=nid, kind=kind, title=title[:80], subtitle=subtitle[:80],
        status="skipped" if skipped else "completed",
        agent=agent, progress=0 if skipped else 100, owner=None, project_id=project_id, meta=meta,
        history=[{"at": now.isoformat(), "event": "Skipped — not needed here" if skipped else "Generated", "actor": agent}],
    )


async def delete_execution(meeting_id: str, db) -> None:
    """Remove the graph, tasks, and project derived from a meeting (idempotent)."""
    await db.execute(delete(GraphEdge).where(GraphEdge.id.like(f"e_{meeting_id}_%")))
    await db.execute(delete(GraphNode).where(GraphNode.id.like(f"g_{meeting_id}_%")))
    await db.execute(delete(Task).where(Task.id.like(f"tk_{meeting_id}_%")))
    for p in (await db.execute(select(Project).where(Project.source_meeting_id == meeting_id))).scalars().all():
        await db.delete(p)
    await db.flush()


async def persist_execution(m: Meeting, state: dict, db) -> str:
    signals = state.get("signals") or {}
    prd = state.get("prd") or {}
    eng = state.get("engineering") or {}
    design = state.get("design") or {}
    qa = state.get("qa") or {}
    sales = state.get("sales") or {}
    cu = state.get("customer_update") or {}
    now = datetime.now(timezone.utc)
    frs = signals.get("featureRequests") or []
    primary = frs[0]["title"] if frs else ((prd.get("goals") or [m.title])[0])
    weeks = eng.get("estimateWeeks") or 6

    await delete_execution(m.id, db)  # replace any prior execution (idempotent re-runs)

    pid = f"p_{uuid.uuid4().hex[:8]}"
    db.add(Project(
        id=pid, name=primary[:60], key=_key(primary), description=(prd.get("problem") or m.title)[:500],
        status="in-progress", health="at-risk" if signals.get("urgency") in ("critical", "high") else "on-track",
        progress=20, start_date=now, target_date=now + timedelta(weeks=weeks),
        delivery_estimate=f"~{weeks} weeks", source_meeting_id=m.id,
        revenue_impact=float(signals.get("revenueImpact") or 0),
        owner={"id": "u_1", "name": "You", "email": "", "role": "Owner", "title": "Owner", "status": "active"},
        team=[], tags=m.tags or [], documents=[],
        prd=_map_prd(prd, now), engineering=_map_engineering(eng), design=_map_design(design),
        qa=_map_qa(qa), sales=_map_sales(sales),
    ))

    # The execution router decided which teams this conversation actually needs.
    teams = state.get("teams") or {}

    def _team(name: str) -> tuple[bool, str]:
        d = teams.get(name) or {}
        return bool(d.get("relevant", True)), d.get("reason", "")

    eng_ok, eng_why = _team("engineering")
    design_ok, design_why = _team("design")
    qa_ok, qa_why = _team("qa")
    sales_ok, sales_why = _team("sales")
    cs_ok, cs_why = _team("customer-success")

    def _team_node(nid: str, kind: str, title: str, subtitle: str, agent: str, ok: bool, why: str) -> GraphNode:
        return _node(nid, kind, title, subtitle if ok else (why or "Not needed for this conversation"),
                     agent, pid, now, skipped=not ok, reason=why)

    g = lambda s: f"g_{m.id}_{s}"
    nodes = [
        _node(g("meeting"), "meeting", m.title, m.account, "meeting-intelligence", pid, now,
              reason="The customer conversation that triggered this work."),
        _node(g("need"), "feature-request", primary, f"Demand {frs[0].get('demand', '')}" if frs else "Customer need",
              "meeting-intelligence", pid, now, reason="The core need extracted from the call."),
        _node(g("prd"), "prd", "PRD", f"{len(prd.get('userStories', []))} stories", "product-manager", pid, now,
              reason="Defines what to build, why it matters, and how success is measured."),
        _team_node(g("eng"), "engineering", "Engineering", f"{weeks} wks · {len(eng.get('components', []))} components", "engineering-planner", eng_ok, eng_why),
        _team_node(g("design"), "design", "Design", f"{len(design.get('flows', []))} flows · {len(design.get('screens', []))} screens", "design-planner", design_ok, design_why),
        _team_node(g("qa"), "qa", "QA", f"Coverage {qa.get('coverageEstimate', 0)}%", "qa-planner", qa_ok, qa_why),
        _team_node(g("sales"), "sales", "Sales", f"{len(sales.get('talkingPoints', []))} talk tracks", "sales-planner", sales_ok, sales_why),
        _team_node(g("cs"), "customer-followup", "Customer Follow-up", cu.get("subject", "") or "Follow-up drafted", "customer-success", cs_ok, cs_why),
    ]
    tasks = [
        Task(id=f"tk_{m.id}_{i}", key=f"{_key(primary)}-{i}", title=c, description="", column="todo",
             priority="high", discipline="engineering", estimate=None, project_id=pid, assignee=None,
             labels=["backend"], links={"meetingId": m.id, "graphNodeId": g("eng")}, created_at=now, updated_at=now)
        for i, c in enumerate(eng.get("components", [])[:5], start=1)
    ]
    db.add_all(nodes)
    db.add_all(tasks)
    await db.flush()  # nodes before edges (FK)

    e = lambda a, b, anim=False: GraphEdge(id=f"e_{m.id}_{a}_{b}", source=g(a), target=g(b), animated=anim)
    db.add_all([
        e("meeting", "need"), e("need", "prd"), e("prd", "eng", True), e("prd", "design", True),
        e("prd", "sales", True), e("eng", "qa", True), e("design", "qa"), e("qa", "cs"), e("sales", "cs", True),
    ])
    return pid
