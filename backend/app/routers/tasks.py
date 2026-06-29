from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Integration, Task
from ..schemas import TaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])

_CONNECTED = {"connected", "syncing"}
_EXTERNAL_PREFIX = {"jira": "JIRA", "linear": "LIN"}


class PatchTaskIn(BaseModel):
    """Partial update. `column` alone preserves the original kanban-move behavior;
    the other fields support edit / reassign / accept-decline from the review screen."""

    column: str | None = None
    priority: str | None = None
    title: str | None = None
    description: str | None = None
    assignee: dict | None = None
    decision: str | None = None  # "accepted" | "declined"


class PushTaskIn(BaseModel):
    target: str  # "jira" | "linear"


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
    if body.decision is not None:
        t.links = {**(t.links or {}), "decision": body.decision}
    t.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(t)
    return t


@router.post("/{task_id}/push", response_model=TaskOut)
async def push_task(task_id: str, body: PushTaskIn, db=Depends(get_db), _=Depends(get_current_user)):
    """Push one work item to a connected tool (Jira/Linear). MVP: faked but persisted."""
    if body.target not in _EXTERNAL_PREFIX:
        raise HTTPException(409, f"{body.target} is not a supported push target")
    t = await db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    integ = await db.get(Integration, body.target)
    if not integ or integ.status not in _CONNECTED:
        raise HTTPException(409, f"{body.target} is not connected")
    prefix = _EXTERNAL_PREFIX.get(body.target, body.target.upper())
    external_key = f"{prefix}-{abs(hash(t.id)) % 900 + 100}"
    t.links = {**(t.links or {}), "pushed": True, "pushedTo": body.target, "externalKey": external_key}
    t.column = "todo" if t.column == "backlog" else t.column
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
