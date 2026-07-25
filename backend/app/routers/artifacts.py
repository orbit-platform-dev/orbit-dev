"""Artifacts — the company's observed memory (Observe + Remember).

Ingest a customer call (paste), pull Linear issues as a sensor, and browse what
Orbit has observed. This is the substrate the reasoning layer reads; it does not
replace any system of record.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from ..deps import Depends, get_db
from ..models import Artifact
from ..schemas import ArtifactOut
from ..services.ingestion import ingest_artifact, pull_all
from ..services.sources import connected_keys as _connected_keys
from ..services.sources import source_visible as _source_visible
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class IngestCallIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    title: str = "Customer call"
    content: str
    source: str = "call"  # call | document


@router.get("", response_model=list[ArtifactOut])
async def list_artifacts(limit: int = 100, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    connected = await _connected_keys(db, ws)
    rows = (
        (
            await db.execute(
                select(Artifact)
                .where(Artifact.workspace_id == ws)
                .order_by(Artifact.occurred_at.desc())
                .limit(min(limit, 200))
            )
        )
        .scalars()
        .all()
    )
    return [a for a in rows if _source_visible(a.source, connected)]


@router.get("/counts")
async def memory_counts(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Real, live totals of what Orbit has analysed — cheap count queries the UI
    polls during a sync so users watch memory grow instead of a frozen screen."""
    from sqlalchemy import func

    from ..models import Entity, Insight, Memory

    connected = await _connected_keys(db, ws)
    by_source = {
        s: c
        for s, c in (
            await db.execute(
                select(Artifact.source, func.count()).where(Artifact.workspace_id == ws).group_by(Artifact.source)
            )
        ).all()
        if _source_visible(s, connected)
    }

    async def _count(model, *extra):
        return (
            await db.execute(select(func.count()).select_from(model).where(model.workspace_id == ws, *extra))
        ).scalar_one()

    return {
        "artifacts": sum(by_source.values()),
        "bySource": by_source,
        "entities": await _count(Entity),
        "facts": await _count(Memory),
        "insights": await _count(Insight, Insight.kind != "brief"),
    }


@router.post("", response_model=ArtifactOut, status_code=201)
async def ingest_call(body: IngestCallIn, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    content = (body.content or "").strip()
    if len(content.split()) < 6:
        raise HTTPException(422, "Paste at least a few sentences so Orbit has something to read")
    art = await ingest_artifact(
        db,
        ws,
        source=body.source or "call",
        kind="call",
        title=(body.title or "Customer call").strip(),
        content=content,
    )
    return art


@router.get("/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(artifact_id: str, db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    art = await db.get(Artifact, artifact_id)
    if not art or art.workspace_id != ws:
        raise HTTPException(404, "Artifact not found")
    return art


@router.post("/pull")
async def pull_sensors(db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Pull new artifacts from every connected sensor now (the same sweep the
    heartbeat runs automatically). Honest per source: 0 when not connected."""
    counts = await pull_all(db, ws)
    return {"ingested": sum(counts.values()), "bySource": counts}
