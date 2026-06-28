from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Project
from ..schemas import ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
async def list_projects(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Project))).scalars().all()


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p
