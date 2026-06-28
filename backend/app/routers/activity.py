from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import ActivityEvent
from ..schemas import ActivityEventOut

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=list[ActivityEventOut])
async def list_activity(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(ActivityEvent).order_by(ActivityEvent.at.desc()))).scalars().all()
