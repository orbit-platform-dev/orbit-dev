"""Generate an engineering spec (human overview + coding-agent markdown) for a
task — invoked from a Feed finding or an in-chat draft. Auth-required, workspace-scoped."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..deps import get_current_user, get_db
from ..models import Insight
from ..services import specs
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/spec", tags=["spec"])


class SpecIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    title: str
    description: str = ""
    finding_id: str | None = None   # optional: a Feed finding to draw the 'why' from


@router.post("")
async def make_spec(body: SpecIn, db=Depends(get_db), ws: str = Depends(get_workspace_id),
                    _user=Depends(get_current_user)):
    title = (body.title or "").strip()
    if len(title) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A task title is required.")

    extra_why = ""
    if body.finding_id:  # ownership-scoped: a foreign id simply yields no extra context
        f = (await db.execute(select(Insight).where(
            Insight.id == body.finding_id, Insight.workspace_id == ws))).scalars().first()
        if f:
            extra_why = f"{f.title}. {(f.detail or '').strip()}".strip()

    spec = await specs.generate(db, ws, title=title, description=body.description, extra_why=extra_why)
    return spec.model_dump(by_alias=True)
