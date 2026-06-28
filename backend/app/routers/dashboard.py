from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import ActivityEvent, Agent, Integration, Meeting, Project, Task, TimelineEvent
from ..schemas import (
    ActivityEventOut,
    AgentOut,
    IntegrationOut,
    MeetingOut,
    ProjectOut,
    TaskOut,
    TimelineEventOut,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def dump(schema, obj):
    return schema.model_validate(obj).model_dump(by_alias=True, mode="json")


@router.get("")
async def get_dashboard(db=Depends(get_db), _=Depends(get_current_user)):
    meetings = (await db.execute(select(Meeting).order_by(Meeting.date.desc()))).scalars().all()
    agents = (await db.execute(select(Agent))).scalars().all()
    projects = (await db.execute(select(Project))).scalars().all()
    tasks = (await db.execute(select(Task))).scalars().all()
    integrations = (await db.execute(select(Integration))).scalars().all()
    activity = (await db.execute(select(ActivityEvent).order_by(ActivityEvent.at.desc()))).scalars().all()
    timeline = (await db.execute(select(TimelineEvent).order_by(TimelineEvent.at.desc()))).scalars().all()

    # --- derived rollups -----------------------------------------------------
    customer_requests = []
    for mt in meetings:
        for fr in (mt.analysis or {}).get("featureRequests", []) if mt.analysis else []:
            customer_requests.append({
                "id": f"cr_{fr.get('id', fr['title'])}", "account": mt.account, "request": fr["title"],
                "demand": fr.get("demand", 50),
                "revenueImpact": (mt.analysis or {}).get("revenueImpact", 0),
                "status": "planned" if fr.get("linkedProjectId") else "new", "at": mt.date.isoformat(),
            })

    follow_ups = []
    for mt in meetings:
        for ai in (mt.analysis or {}).get("actionItems", []) if mt.analysis else []:
            if ai.get("status") != "done":
                follow_ups.append({
                    "id": f"f_{ai.get('id', ai['title'])}", "title": ai["title"], "account": mt.account,
                    "due": mt.date.isoformat(), "owner": {"id": "u_5", "name": ai.get("owner", "Team")},
                    "priority": "urgent" if (mt.analysis or {}).get("urgency") == "critical" else "high",
                })

    delivery_estimates = [{
        "projectId": p.id, "name": p.name, "estimate": p.delivery_estimate,
        "confidence": 80 if p.health == "on-track" else 60 if p.health == "at-risk" else 30,
        "trend": "up" if p.health == "on-track" else "down" if p.health == "off-track" else "steady",
    } for p in projects]

    pipeline = sum(p.revenue_impact for p in projects)
    at_risk = sum((m.analysis or {}).get("revenueImpact", 0) for m in meetings if (m.analysis or {}).get("urgency") == "critical")
    revenue_trends = [
        {"label": "Pipeline influenced", "value": f"${pipeline/1e6:.1f}M", "delta": 18.2, "spark": [2.1, 2.3, 2.6, 2.9, 3.1, 3.4]},
        {"label": "Revenue at risk", "value": f"${at_risk/1e3:.0f}K", "delta": -12.0, "spark": [820, 700, 640, 560, 520, 480]},
        {"label": "Active agents", "value": str(sum(1 for a in agents if a.status in ("running", "thinking"))), "delta": 25.0, "spark": [2, 3, 3, 4, 4, 5]},
        {"label": "Avg. analysis time", "value": "42s", "delta": -31.0, "spark": [98, 86, 74, 66, 49, 42]},
    ]

    return {
        "meetings": [dump(MeetingOut, x) for x in meetings[:4]],
        "agents": [dump(AgentOut, x) for x in agents],
        "projects": [dump(ProjectOut, x) for x in projects],
        "tasks": [dump(TaskOut, x) for x in tasks],
        "integrations": [dump(IntegrationOut, x) for x in integrations],
        "activity": [dump(ActivityEventOut, x) for x in activity[:6]],
        "timeline": [dump(TimelineEventOut, x) for x in timeline[:6]],
        "customerRequests": customer_requests[:5],
        "followUps": follow_ups[:4],
        "deliveryEstimates": delivery_estimates,
        "revenueTrends": revenue_trends,
    }
