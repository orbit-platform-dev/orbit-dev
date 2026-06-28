from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import TimelineEvent
from ..schemas import TimelineEventOut

router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("", response_model=list[TimelineEventOut])
async def get_timeline(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(TimelineEvent).order_by(TimelineEvent.at.desc()))).scalars().all()
