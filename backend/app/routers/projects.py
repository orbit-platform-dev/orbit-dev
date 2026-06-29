from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Project
from ..schemas import ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


class PatchProjectIn(BaseModel):
    """Edit the generated, still-draft artifacts before approval."""

    name: str | None = None
    prd: dict | None = None
    customer_update: dict | None = None
    timeline: dict | None = None


@router.get("", response_model=list[ProjectOut])
async def list_projects(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Project))).scalars().all()


@router.patch("/{project_id}", response_model=ProjectOut)
async def patch_project(project_id: str, body: PatchProjectIn, db=Depends(get_db), _=Depends(get_current_user)):
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    if p.approval_status == "approved":
        raise HTTPException(409, "Execution plan is approved and locked")
    for field in ("name", "prd", "customer_update", "timeline"):
        value = getattr(body, field)
        if value is not None:
            setattr(p, field, value)
    await db.commit()
    await db.refresh(p)
    return p


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p
