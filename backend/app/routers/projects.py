import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Integration, Project
from ..schemas import ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])

# Deep-link templates per PRD publish target. The actual create-document API call for
# each tool slots in here later; for now we record the destination + a link.
_DOC_URL = {
    "google-docs": lambda t: f"https://docs.google.com/document/d/{t}/edit",
    "notion": lambda t: f"https://www.notion.so/orbit/{t}",
    "confluence": lambda t: f"https://orbit.atlassian.net/wiki/spaces/PRD/pages/{t}",
    "linear": lambda t: f"https://linear.app/orbit/document/{t}",
    "jira": lambda t: f"https://orbit.atlassian.net/browse/PRD-{t}",
}


class PatchProjectIn(BaseModel):
    """Edit the generated, still-draft artifacts before approval.

    Accepts camelCase from the frontend (e.g. `customerUpdate`) to match the rest
    of the API's serialization convention."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

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


class PublishPrdIn(BaseModel):
    target: str  # "linear" | "google-docs" | "confluence"


@router.post("/{project_id}/publish-prd")
async def publish_prd(project_id: str, body: PublishPrdIn, db=Depends(get_db), _=Depends(get_current_user)):
    """Publish the PRD to a connected doc tool and record the deep link on the PRD.

    Stubbed: returns a placeholder link until each integration's real create-document
    call is wired in. The tool must be connected first."""
    if body.target not in _DOC_URL:
        raise HTTPException(409, f"{body.target} is not a supported publish target")
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    if not p.prd:
        raise HTTPException(409, "This project has no PRD to publish")
    integ = await db.get(Integration, body.target)
    if not integ or integ.status not in ("connected", "syncing"):
        raise HTTPException(409, f"{body.target} is not connected")

    publication = {
        "tool": body.target,
        "url": _DOC_URL[body.target](uuid.uuid4().hex[:12]),
        "at": datetime.now(timezone.utc).isoformat(),
    }
    p.prd = {**p.prd, "publication": publication}  # new dict so SQLAlchemy persists the JSON change
    await db.commit()
    return publication
