"""Company intelligence: detected insights (risks/gaps/trends/wins) + the brief.

Detection is deterministic and evidence-backed (services/insights.py); the
LLM only writes the brief. Both also run on the heartbeat's schedule — the
endpoints here are the manual "scan now" path and the status window.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Insight
from ..schemas import InsightOut
from ..services import heartbeat
from ..services.insights import detect_insights, generate_brief
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("", response_model=list[InsightOut])
async def list_insights(status: str | None = None, db=Depends(get_db),
                        ws: str = Depends(get_workspace_id)):
    q = select(Insight).where(Insight.workspace_id == ws)
    if status:
        q = q.where(Insight.status == status)
    return (await db.execute(q.order_by(Insight.created_at.desc()).limit(100))).scalars().all()


@router.post("/scan", response_model=list[InsightOut])
async def scan(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Run every gap/risk/trend detector now. Idempotent — re-scanning never
    duplicates an open insight."""
    found = await detect_insights(db, ws)
    await db.commit()
    return found


@router.post("/brief", response_model=InsightOut)
async def brief_now(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Generate the company intelligence brief from current context, now."""
    brief = await generate_brief(db, ws)
    await db.commit()
    await db.refresh(brief)
    return brief


@router.get("/heartbeat")
async def heartbeat_status(_=Depends(get_current_user)):
    """When Orbit last scanned on its own, and how often it does."""
    return heartbeat.status()


class PatchInsightIn(BaseModel):
    status: str  # open | acknowledged | resolved


@router.patch("/{insight_id}", response_model=InsightOut)
async def patch_insight(insight_id: str, body: PatchInsightIn,
                        db=Depends(get_db), _=Depends(get_current_user)):
    ins = await db.get(Insight, insight_id)
    if not ins:
        raise HTTPException(404, "Insight not found")
    if body.status not in ("open", "acknowledged", "resolved"):
        raise HTTPException(422, "status must be open, acknowledged or resolved")
    ins.status = body.status
    await db.commit()
    await db.refresh(ins)
    return ins
