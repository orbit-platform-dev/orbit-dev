from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Integration
from ..schemas import IntegrationOut
from ..services import linear

router = APIRouter(prefix="/integrations", tags=["integrations"])

# Honesty rule: nothing is "connectable" as a bare status flag. Real
# connections happen through real auth — OAuth routers (zoom/calendar/meet)
# or the key-based endpoints below (linear). Everything else is roadmap.
CONNECTABLE: set[str] = set()


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


class ConnectLinearIn(BaseModel):
    apiKey: str


@router.post("/linear/connect", response_model=IntegrationOut)
async def connect_linear(body: ConnectLinearIn, db=Depends(get_db), _=Depends(get_current_user)):
    """Connect Linear with a personal API key — validated live, never assumed."""
    key = body.apiKey.strip()
    if not key:
        raise HTTPException(422, "API key is required")
    try:
        org = await linear.validate_key(key)
    except Exception as exc:
        raise HTTPException(422, f"Linear rejected the key: {exc}")
    integ = await db.get(Integration, "linear")
    if not integ:
        raise HTTPException(404, "Integration not found")
    integ.credentials = {"apiKey": key}
    integ.status = "connected"
    integ.account = org
    integ.last_sync = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(integ)
    return integ


@router.post("/linear/disconnect", response_model=IntegrationOut)
async def disconnect_linear(db=Depends(get_db), _=Depends(get_current_user)):
    integ = await db.get(Integration, "linear")
    if not integ:
        raise HTTPException(404, "Integration not found")
    integ.credentials = None
    integ.status = "disconnected"
    integ.account = None
    integ.last_sync = None
    await db.commit()
    await db.refresh(integ)
    return integ
