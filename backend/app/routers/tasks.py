from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import ExecutionPlan, Task
from ..services import linear
from ..schemas import TaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])

async def _plan_approved(db, task: Task) -> bool:
    if not task.project_id:
        return False
    p = await db.get(ExecutionPlan, task.project_id)
    return bool(p and p.approval_status == "approved")


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
    # Approval locks the whole plan — kanban `column` moves stay allowed (that's
    # delivery tracking, not editing the approved plan).
    if await _plan_approved(db, t) and any(
        getattr(body, f) is not None for f in ("priority", "title", "description", "assignee", "decision")
    ):
        raise HTTPException(409, "Proposal is approved and locked")
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
    """Create this work item as a REAL issue in the tracker. Linear only today —
    no fabricated keys; anything unimplemented refuses honestly."""
    if body.target != "linear":
        raise HTTPException(409, f"Pushing to {body.target} is on the roadmap — connect Linear to create real issues")
    t = await db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    api_key = await linear.get_api_key(db)
    if not api_key:
        raise HTTPException(409, "Linear is not connected")
    created = await linear.create_issue(
        api_key, t.title,
        f"{t.description}\n\n—\nCreated by Orbit from an approved proposal. "
        f"Reason: {(t.links or {}).get('reason', '')}")
    t.links = {**(t.links or {}), "pushed": True, "pushedTo": "linear",
               "externalKey": created["identifier"], "externalUrl": created["url"]}
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
        if await _plan_approved(db, t):
            raise HTTPException(409, "Proposal is approved and locked")
        await db.delete(t)
        await db.commit()
