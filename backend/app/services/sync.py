"""Synchronization engine.

Orbit prepares updates; it never executes them on its own. Approval creates one
pending SyncJob per approved section that has somewhere to go — and stops
there. Each job runs only when a human explicitly triggers it (`run_job`, via
the review screen's Send / Publish / Sync buttons). Each executor is the seam
where the real destination API call slots in — today they produce the same
stubbed deep-links the manual publish/push paths use, but through the audited
job pipeline (status, result, error, timestamps).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select

from ..models import (
    ActivityEvent, Customer, ExecutionPlan, GraphNode, Integration, Meeting, SyncJob, Task, TimelineEvent,
)

logger = logging.getLogger("orbit.sync")

# Candidate destinations per section, in preference order; first connected wins.
_DESTINATIONS = {
    "crm-update": ["salesforce", "hubspot"],
    "publish-prd": ["notion", "confluence", "google-docs"],
    "create-tasks": ["jira", "linear"],
}
_CONNECTED = {"connected", "syncing"}

_DOC_URL = {
    "google-docs": lambda t: f"https://docs.google.com/document/d/{t}/edit",
    "notion": lambda t: f"https://www.notion.so/orbit/{t}",
    "confluence": lambda t: f"https://orbit.atlassian.net/wiki/spaces/PRD/pages/{t}",
}
_TASK_PREFIX = {"jira": "JIRA", "linear": "LIN"}


def _skipped(section: dict | None) -> bool:
    return not section or bool(section.get("skipped"))


async def _first_connected(db, keys: list[str]) -> str | None:
    for key in keys:
        integ = await db.get(Integration, key)
        if integ and integ.status in _CONNECTED:
            return key
    return None


def _job(p: ExecutionPlan, kind: str, destination: str, payload: dict, status: str = "pending",
         error: str | None = None) -> SyncJob:
    return SyncJob(
        id=f"sj_{uuid.uuid4().hex[:8]}", workspace_id=p.workspace_id, plan_id=p.id,
        customer_id=p.customer_id, kind=kind, destination=destination, status=status,
        payload=payload, error=error, created_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc) if status == "skipped" else None,
    )


async def create_sync_jobs(db, m: Meeting, p: ExecutionPlan) -> list[SyncJob]:
    """Prepare one job per approved section. Sections with no connected
    destination become `skipped` jobs so the review screen can say why."""
    jobs: list[SyncJob] = []

    if not _skipped(p.crm_update):
        dest = await _first_connected(db, _DESTINATIONS["crm-update"])
        jobs.append(_job(p, "crm-update", dest or "crm",
                         {"summary": p.crm_update.get("accountSummary", ""), "planName": p.name},
                         status="pending" if dest else "skipped",
                         error=None if dest else "No CRM connected — connect Salesforce or HubSpot to sync."))
    if p.prd:
        dest = await _first_connected(db, _DESTINATIONS["publish-prd"])
        jobs.append(_job(p, "publish-prd", dest or "docs",
                         {"title": p.prd.get("title") or p.name},
                         status="pending" if dest else "skipped",
                         error=None if dest else "No doc tool connected — connect Notion, Confluence or Google Docs."))
    accepted = [t for t in (await db.execute(select(Task).where(Task.project_id == p.id))).scalars().all()
                if (t.links or {}).get("decision") != "declined"]
    if accepted:
        dest = await _first_connected(db, _DESTINATIONS["create-tasks"])
        jobs.append(_job(p, "create-tasks", dest or "tracker",
                         {"taskIds": [t.id for t in accepted], "count": len(accepted)},
                         status="pending" if dest else "skipped",
                         error=None if dest else "No issue tracker connected — connect Jira or Linear."))
    if not _skipped(p.customer_update):
        jobs.append(_job(p, "send-email", "email", {
            "subject": p.customer_update.get("subject", ""),
            "body": p.customer_update.get("body", ""),
            "to": p.customer_update.get("to", ""),
        }))

    db.add_all(jobs)
    await db.flush()
    return jobs


# --- Executors (the real-API seam) --------------------------------------------
async def _execute_job(db, job: SyncJob) -> dict:
    """Perform one job against its destination. STUBBED: records the same
    placeholder deep-links the manual publish path used, until each real
    integration API is wired in behind this seam."""
    ref = uuid.uuid4().hex[:12]
    if job.kind == "publish-prd":
        plan = await db.get(ExecutionPlan, job.plan_id)
        url = _DOC_URL[job.destination](ref)
        if plan and plan.prd:
            plan.prd = {**plan.prd, "publication": {"tool": job.destination, "url": url,
                                                    "at": datetime.now(timezone.utc).isoformat()}}
        return {"url": url}
    if job.kind == "create-tasks":
        prefix = _TASK_PREFIX.get(job.destination, job.destination.upper())
        keys = []
        for tid in job.payload.get("taskIds", []):
            t = await db.get(Task, tid)
            if not t:
                continue
            external = f"{prefix}-{abs(hash(t.id)) % 900 + 100}"
            t.links = {**(t.links or {}), "pushed": True, "pushedTo": job.destination, "externalKey": external}
            t.column = "todo" if t.column == "backlog" else t.column
            t.updated_at = datetime.now(timezone.utc)
            keys.append(external)
        return {"externalKeys": keys, "count": len(keys)}
    if job.kind == "crm-update":
        return {"note": f"CRM update prepared for {job.destination}", "ref": ref}
    if job.kind == "send-email":
        to = job.payload.get("to", "")
        return {"note": f"Follow-up email sent to {to}" if to else "Follow-up email prepared",
                "to": to, "subject": job.payload.get("subject", "")}
    raise ValueError(f"Unknown sync job kind: {job.kind}")


async def run_job(db, job: SyncJob) -> SyncJob:
    """Execute ONE prepared job — the explicit, human-triggered step.

    Skipped jobs are retried by re-resolving a destination (e.g. the user
    connected a CRM after approving). Failed jobs can be re-run. The send-email
    recipient is learned back onto the Customer so future plans auto-fill it.
    """
    if job.status in ("done", "running"):
        raise HTTPException(409, f"This update is already {job.status}")
    if job.kind == "send-email" and not job.payload.get("to"):
        raise HTTPException(409, "Add a recipient before sending the follow-up email")
    if job.kind != "send-email":
        dest = await _first_connected(db, _DESTINATIONS.get(job.kind, []))
        if not dest:
            raise HTTPException(409, job.error or f"No connected destination for {job.kind}")
        job.destination = dest

    job.status = "running"
    job.error = None
    await db.commit()
    try:
        job.result = await _execute_job(db, job)
        job.status = "done"
        integ = await db.get(Integration, job.destination)
        if integ:
            integ.last_sync = datetime.now(timezone.utc)
        await _learn_contact(db, job)
        db.add(ActivityEvent(
            id=f"ac_{uuid.uuid4().hex[:8]}", actor={"name": "You"},
            action="synchronized", target=f"{job.kind} → {job.destination}",
            target_type="project", at=datetime.now(timezone.utc),
            project_id=job.plan_id,
        ))
    except Exception as exc:
        logger.exception("sync job %s failed", job.id)
        job.status = "failed"
        job.error = str(exc)[:300]
    job.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await _finalize_if_complete(db, job.plan_id)
    return job


async def _learn_contact(db, job: SyncJob) -> None:
    """Remember the follow-up recipient on the Customer for future auto-fill."""
    to = job.payload.get("to") if job.kind == "send-email" else None
    if not (to and job.customer_id):
        return
    customer = await db.get(Customer, job.customer_id)
    if customer and (customer.meta or {}).get("contactEmail") != to:
        customer.meta = {**(customer.meta or {}), "contactEmail": to}


async def _finalize_if_complete(db, plan_id: str) -> None:
    """Once no job is left pending/running, complete the graph's sync node."""
    jobs = (await db.execute(select(SyncJob).where(SyncJob.plan_id == plan_id))).scalars().all()
    if any(j.status in ("pending", "running") for j in jobs):
        return
    plan = await db.get(ExecutionPlan, plan_id)
    if not plan:
        return
    done = sum(1 for j in jobs if j.status == "done")
    db.add(TimelineEvent(
        id=f"ev_{uuid.uuid4().hex[:8]}", kind="synchronized", title="Synchronization complete",
        description=f"{done} of {len(jobs)} prepared updates delivered to connected tools.",
        at=datetime.now(timezone.utc), actor="You",
        project_id=plan.id, meeting_id=plan.source_meeting_id,
    ))
    if plan.source_meeting_id:
        node = await db.get(GraphNode, f"g_{plan.source_meeting_id}_sync")
        if node:
            node.status = "completed"
            node.progress = 100
            node.subtitle = f"{done}/{len(jobs)} destinations updated"
    await db.commit()
