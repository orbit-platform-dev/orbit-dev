import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..agents.orchestrator import generate_prd_draft
from ..agents.persistence import _map_prd
from ..context.engine import build_context_package, render_context
from ..deps import Depends, get_current_user, get_db
from ..models import GraphNode, Integration, Meeting, Project, SyncJob
from ..schemas import ProjectOut, SyncJobOut
from ..services.sync import run_job

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
    crm_update: dict | None = None
    customer_update: dict | None = None
    timeline: dict | None = None
    internal_notes: str | None = None


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
    for field in ("name", "prd", "crm_update", "customer_update", "timeline", "internal_notes"):
        value = getattr(body, field)
        if value is not None:
            setattr(p, field, value)
    await db.commit()
    await db.refresh(p)
    return p


@router.get("/{project_id}/sync-jobs", response_model=list[SyncJobOut])
async def list_sync_jobs(project_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Synchronization status per destination — prepared at approval, run explicitly."""
    return (await db.execute(
        select(SyncJob).where(SyncJob.plan_id == project_id).order_by(SyncJob.created_at)
    )).scalars().all()


@router.post("/{project_id}/generate-prd", response_model=ProjectOut)
async def generate_prd(project_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Generate the PRD on demand — no PRD exists until a human asks for one.
    Runs the product-manager agent against the CURRENT (possibly edited)
    customer intent plus the customer's Context Package."""
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Execution plan not found")
    if p.approval_status == "approved":
        raise HTTPException(409, "Execution plan is approved and locked")
    m = await db.get(Meeting, p.source_meeting_id) if p.source_meeting_id else None
    if not m or not m.analysis:
        raise HTTPException(409, "No analyzed meeting behind this plan")

    context = ""
    if p.customer_id:
        summary = (m.analysis or {}).get("summary", "")
        pkg = await build_context_package(db, p.customer_id, exclude_meeting_id=m.id,
                                          query_text=summary or None, wide=True)
        context = render_context(pkg)
    draft = await generate_prd_draft(m.analysis, context)
    p.prd = _map_prd(draft, datetime.now(timezone.utc))

    node = await db.get(GraphNode, f"g_{m.id}_prd")
    if node:
        node.status = "completed"
        node.progress = 100
        node.subtitle = (p.prd.get("title") or "Drafted")[:80]
    await db.commit()
    await db.refresh(p)
    return p


class RunSyncJobIn(BaseModel):
    to: str | None = None  # recipient for send-email jobs (delivery metadata, not plan content)


@router.post("/{project_id}/sync-jobs/{job_id}/run", response_model=SyncJobOut)
async def run_sync_job(project_id: str, job_id: str, body: RunSyncJobIn | None = None,
                       db=Depends(get_db), _=Depends(get_current_user)):
    """Explicitly execute one prepared update. Approval only prepares — nothing
    reaches an external tool until a human clicks the corresponding action."""
    p = await db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Execution plan not found")
    if p.approval_status != "approved":
        raise HTTPException(409, "Approve the execution plan first — nothing leaves Orbit before approval")
    job = await db.get(SyncJob, job_id)
    if not job or job.plan_id != project_id:
        raise HTTPException(404, "Sync job not found")
    if body and body.to and job.kind == "send-email":
        job.payload = {**job.payload, "to": body.to.strip()}
    return await run_job(db, job)


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
