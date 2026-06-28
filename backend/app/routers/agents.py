from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import Agent
from ..schemas import AgentOut

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
async def list_agents(db=Depends(get_db), _=Depends(get_current_user)):
    return (await db.execute(select(Agent))).scalars().all()
