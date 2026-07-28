"""Chat credits — this person's remaining beta allowance, and asking for more."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ..deps import get_current_user, get_db
from ..services import credits
from ..services.workspace import get_workspace_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credits", tags=["credits"])


class CreditsOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    balance: int
    granted: int
    used: int
    exhausted: bool
    requested_at: datetime | None = None


class RequestIn(BaseModel):
    """Clerk session tokens carry no email claim, so the client sends who is
    asking — same contract the feedback widget uses."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    email: str | None = None
    name: str | None = None


def _uid(user) -> str:
    return user.get("sub") or "demo_user"


@router.get("", response_model=CreditsOut)
async def my_credits(db=Depends(get_db), ws: str = Depends(get_workspace_id), user=Depends(get_current_user)):
    out = await credits.status(db, ws, _uid(user))
    await db.commit()  # first read materializes the row
    return CreditsOut(**out)


@router.post("/request")
async def request_credits(
    body: RequestIn | None = None,
    db=Depends(get_db),
    ws: str = Depends(get_workspace_id),
    user=Depends(get_current_user),
):
    if not credits.can_request():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Credit requests aren't set up yet.")
    body = body or RequestIn()
    email = (body.email or user.get("email") or user.get("sub") or "unknown").strip()
    name = (body.name or user.get("name") or "").strip()
    try:
        issue = await credits.request_more(db, ws, _uid(user), email=email, name=name)
    except PermissionError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.warning("credit request failed", exc_info=True)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not send your request: {exc}") from exc
    await db.commit()
    return {"requested": True, **issue}
