from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Task
from ..schemas import TaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])


class MoveTaskIn(BaseModel):
    column: str


@router.get("", response_model=list[TaskOut])
async def list_tasks(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Task))).scalars().all()


@router.patch("/{task_id}", response_model=TaskOut)
async def move_task(task_id: str, body: MoveTaskIn, db=Depends(get_db), _=Depends(get_current_user)):
    t = await db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    t.column = body.column
    t.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(t)
    return t
