"""Company goals — the declared intentions the comparator measures reality
against. Deliberately minimal: a goal is a sentence, optionally a date. The
intelligence comes from the detectors comparing signals and Linear state to it,
not from the CRUD."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Goal
from ..schemas import GoalOut
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/goals", tags=["goals"])


class GoalIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    title: str
    detail: str = ""
    target_date: datetime | None = None


class PatchGoalIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    title: str | None = None
    detail: str | None = None
    target_date: datetime | None = None
    status: str | None = None  # open | achieved | dropped


@router.get("", response_model=list[GoalOut])
async def list_goals(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    return (await db.execute(
        select(Goal).where(Goal.workspace_id == ws).order_by(Goal.created_at.desc())
    )).scalars().all()


@router.post("", response_model=GoalOut, status_code=201)
async def create_goal(body: GoalIn, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    if not body.title.strip():
        raise HTTPException(422, "A goal needs a title")
    g = Goal(id=f"gl_{uuid.uuid4().hex[:8]}", workspace_id=ws, title=body.title.strip()[:200],
             detail=body.detail.strip(), target_date=body.target_date,
             status="open", created_at=datetime.now(timezone.utc))
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return g


@router.patch("/{goal_id}", response_model=GoalOut)
async def patch_goal(goal_id: str, body: PatchGoalIn, db=Depends(get_db), _=Depends(get_current_user)):
    g = await db.get(Goal, goal_id)
    if not g:
        raise HTTPException(404, "Goal not found")
    if body.status is not None and body.status not in ("open", "achieved", "dropped"):
        raise HTTPException(422, "status must be open, achieved or dropped")
    for field in ("title", "detail", "target_date", "status"):
        value = getattr(body, field)
        if value is not None:
            setattr(g, field, value)
    await db.commit()
    await db.refresh(g)
    return g


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(goal_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    g = await db.get(Goal, goal_id)
    if g:
        await db.delete(g)
        await db.commit()
