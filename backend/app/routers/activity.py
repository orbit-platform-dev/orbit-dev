from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import ActivityEvent, Meeting, Project
from ..schemas import ActivityEventOut

router = APIRouter(prefix="/activity", tags=["activity"])


async def visible_activity(db) -> list[ActivityEvent]:
    """Activity whose subject still exists — deleting a meeting/project must not
    leave ghost entries in "What Orbit did". Rows created before `meeting_id`
    existed are matched by meeting title as a fallback."""
    rows = (await db.execute(select(ActivityEvent).order_by(ActivityEvent.at.desc()))).scalars().all()
    meetings = (await db.execute(select(Meeting.id, Meeting.title))).all()
    meeting_ids = {m.id for m in meetings}
    meeting_titles = {m.title for m in meetings}
    project_ids = set((await db.execute(select(Project.id))).scalars().all())

    def alive(a: ActivityEvent) -> bool:
        if a.meeting_id:
            return a.meeting_id in meeting_ids
        if a.project_id:
            return a.project_id in project_ids
        if a.target_type == "meeting":
            return a.target in meeting_titles
        return True

    return [a for a in rows if alive(a)]


@router.get("", response_model=list[ActivityEventOut])
async def list_activity(db=Depends(get_db), _=Depends(get_current_user)):
    return await visible_activity(db)
