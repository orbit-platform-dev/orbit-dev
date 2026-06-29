from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Integration
from ..schemas import IntegrationOut

router = APIRouter(prefix="/integrations", tags=["integrations"])

# Only these are wired as (fake) connectors for the MVP; the rest are "coming soon".
CONNECTABLE = {"jira", "linear"}


class PatchIntegrationIn(BaseModel):
    status: str  # "connected" | "disconnected"


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Integration))).scalars().all()


@router.patch("/{key}", response_model=IntegrationOut)
async def patch_integration(key: str, body: PatchIntegrationIn, db=Depends(get_db), _=Depends(get_current_user)):
    if key not in CONNECTABLE:
        raise HTTPException(409, f"{key} is coming soon and cannot be connected yet")
    integ = await db.get(Integration, key)
    if not integ:
        raise HTTPException(404, "Integration not found")
    integ.status = "connected" if body.status == "connected" else "disconnected"
    integ.last_sync = datetime.now(timezone.utc) if integ.status == "connected" else None
    await db.commit()
    await db.refresh(integ)
    return integ
