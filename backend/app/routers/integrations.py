from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Integration
from ..schemas import IntegrationOut

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Integration))).scalars().all()
