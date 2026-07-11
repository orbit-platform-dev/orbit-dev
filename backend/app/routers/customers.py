"""Customers — the real entity behind the account label.

Meetings, execution plans and knowledge all hang off a Customer; these
endpoints expose that history (list with rollups, profile, knowledge feed) and
let commitments be closed out.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select, update

from ..deps import Depends, get_current_user, get_db
from ..models import Customer, ExecutionPlan, KnowledgeItem, Meeting
from ..schemas import CustomerOut, KnowledgeItemOut
from ..services.customers import resolve_customer
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/customers", tags=["customers"])


async def _rollup(db, c: Customer) -> dict:
    meetings = (await db.execute(
        select(Meeting).where(Meeting.customer_id == c.id))).scalars().all()
    plans = (await db.execute(
        select(ExecutionPlan).where(ExecutionPlan.customer_id == c.id))).scalars().all()
    open_commitments = (await db.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.customer_id == c.id, KnowledgeItem.kind == "commitment",
            KnowledgeItem.status == "open"))).scalars().all()
    return {
        "id": c.id, "name": c.name, "domains": c.domains or [], "aliases": c.aliases or [],
        "createdAt": c.created_at,
        "meetingCount": len(meetings),
        "planCount": len(plans),
        "approvedPlanCount": sum(1 for p in plans if p.approval_status == "approved"),
        "openCommitments": len(open_commitments),
        "lastMeetingAt": max((m.date for m in meetings if m.date), default=None),
    }


@router.get("", response_model=list[CustomerOut])
async def list_customers(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    rows = (await db.execute(
        select(Customer).where(Customer.workspace_id == ws).order_by(Customer.name))).scalars().all()
    return [await _rollup(db, c) for c in rows]


class CreateCustomerIn(BaseModel):
    name: str
    domain: str | None = None
    contactEmail: str | None = None


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(body: CreateCustomerIn, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Create a customer directly (meetings also auto-create them on ingest).
    Reuses identity resolution so 'Acme Inc' never becomes a duplicate of 'acme'."""
    if not body.name.strip():
        raise HTTPException(422, "Customer name is required")
    emails = [f"contact@{body.domain.strip().lower()}"] if body.domain else None
    c = await resolve_customer(db, ws, body.name.strip(), emails)
    if not c:
        raise HTTPException(422, "That name is too generic to identify a customer")
    if body.contactEmail:
        c.meta = {**(c.meta or {}), "contactEmail": body.contactEmail.strip()}
    await db.commit()
    return await _rollup(db, c)


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    c = await db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Customer not found")
    return await _rollup(db, c)


@router.delete("/{customer_id}", status_code=204)
async def delete_customer(customer_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Delete the customer entity and its knowledge. Signals
    and plans are SOURCE DATA — they survive, just unlinked (re-uploading a
    meeting with the same name would create a fresh customer)."""
    c = await db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Customer not found")
    await db.execute(delete(KnowledgeItem).where(KnowledgeItem.customer_id == customer_id))
    await db.execute(update(Meeting).where(Meeting.customer_id == customer_id)
                     .values(customer_id=None))
    await db.execute(update(ExecutionPlan).where(ExecutionPlan.customer_id == customer_id)
                     .values(customer_id=None))
    await db.delete(c)
    await db.commit()


@router.get("/{customer_id}/knowledge", response_model=list[KnowledgeItemOut])
async def list_knowledge(customer_id: str, kind: str | None = None,
                         db=Depends(get_db), _=Depends(get_current_user)):
    q = select(KnowledgeItem).where(KnowledgeItem.customer_id == customer_id)
    if kind:
        q = q.where(KnowledgeItem.kind == kind)
    return (await db.execute(q.order_by(KnowledgeItem.created_at.desc()))).scalars().all()


class PatchKnowledgeIn(BaseModel):
    status: str  # open | completed


@router.patch("/knowledge/{item_id}", response_model=KnowledgeItemOut)
async def patch_knowledge(item_id: str, body: PatchKnowledgeIn,
                          db=Depends(get_db), _=Depends(get_current_user)):
    """Close (or reopen) a commitment."""
    item = await db.get(KnowledgeItem, item_id)
    if not item:
        raise HTTPException(404, "Knowledge item not found")
    if body.status not in ("open", "completed"):
        raise HTTPException(422, "status must be open or completed")
    item.status = body.status
    await db.commit()
    await db.refresh(item)
    return item
