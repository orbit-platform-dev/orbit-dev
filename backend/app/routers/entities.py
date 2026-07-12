"""Entities — the company model (Understand).

Browse the resolved graph: customers, commitments and features derived from
artifacts, and traverse from any entity to the artifacts that evidence it and
the entities it connects to.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..deps import Depends, get_db
from ..models import Artifact, Entity
from ..schemas import ArtifactOut, EntityDetailOut, EntityOut, LinkedArtifactOut, LinkedEntityOut
from ..services.model import neighbors
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/entities", tags=["entities"])


@router.get("", response_model=list[EntityOut])
async def list_entities(kind: str | None = None, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    q = select(Entity).where(Entity.workspace_id == ws)
    if kind:
        q = q.where(Entity.kind == kind)
    return (await db.execute(q.order_by(Entity.updated_at.desc()))).scalars().all()


@router.get("/{entity_id}", response_model=EntityDetailOut)
async def get_entity(entity_id: str, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    entity = await db.get(Entity, entity_id)
    if not entity or entity.workspace_id != ws:
        raise HTTPException(404, "Entity not found")

    artifacts: list[LinkedArtifactOut] = []
    related: list[LinkedEntityOut] = []
    for link in await neighbors(db, ws, entity_id):
        other_type = link.to_type if link.from_id == entity_id else link.from_type
        other_id = link.to_id if link.from_id == entity_id else link.from_id
        if other_type == "artifact":
            a = await db.get(Artifact, other_id)
            if a:
                artifacts.append(LinkedArtifactOut(type=link.type, artifact=ArtifactOut.model_validate(a)))
        else:
            e = await db.get(Entity, other_id)
            if e:
                related.append(LinkedEntityOut(type=link.type, entity=EntityOut.model_validate(e)))

    return EntityDetailOut(
        entity=EntityOut.model_validate(entity), artifacts=artifacts, related_entities=related,
    )
