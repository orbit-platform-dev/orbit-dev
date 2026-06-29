from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Task
from ..schemas import TaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])


class PatchTaskIn(BaseModel):
    """Partial update. `column` alone preserves the original kanban-move behavior;
    the other fields support edit / reassign from the execution review screen."""

    column: str | None = None
    priority: str | None = None
    title: str | None = None
    description: str | None = None
    assignee: dict | None = None


@router.get("", response_model=list[TaskOut])
async def list_tasks(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Task))).scalars().all()


@router.patch("/{task_id}", response_model=TaskOut)
async def patch_task(task_id: str, body: PatchTaskIn, db=Depends(get_db), _=Depends(get_current_user)):
    t = await db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    for field in ("column", "priority", "title", "description", "assignee"):
        value = getattr(body, field)
        if value is not None:
            setattr(t, field, value)
    t.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(t)
    return t


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Skip/remove a work item from the plan."""
    t = await db.get(Task, task_id)
    if t:
        await db.delete(t)
        await db.commit()
