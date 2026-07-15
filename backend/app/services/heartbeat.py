"""The heartbeat — what makes Orbit an operating system instead of a program.

A background loop that scans every workspace for gaps/risks/trends and
refreshes the company brief when it goes stale. It ONLY reads and writes
insights — it never executes actions, never touches external tools beyond
read-only Linear queries, and never approves anything. The approval invariant
is untouched: humans decide, the heartbeat notices.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from ..config import settings
from ..database import SessionLocal
from ..models import ActivityEvent, Artifact, Entity, Insight, Workspace
from .ingestion import backfill_embeddings, pull_all
from .proposals import dispatch_for_workspace
from .reasoning import detect_findings, generate_brief

logger = logging.getLogger("orbit.heartbeat")

_STARTUP_DELAY_S = 20  # let migrations/seed settle before the first tick

_state: dict = {
    "enabled": settings.heartbeat_enabled,
    "interval_minutes": settings.heartbeat_interval_minutes,
    "last_run_at": None,
    "last_found": 0,
    "last_brief_at": None,
    "ticks": 0,
}
_task: asyncio.Task | None = None

# Per-workspace progress for an immediate sync (triggered on connect / "Pull
# now"). The UI polls this so the user watches memory being built, per the doc's
# onboarding "live progress line".
_sync: dict[str, dict] = {}


def status(ws: str | None = None) -> dict:
    # camelCase to match the API's serialization convention.
    return {
        "enabled": _state["enabled"],
        "intervalMinutes": _state["interval_minutes"],
        "lastRunAt": _state["last_run_at"],
        "lastFound": _state["last_found"],
        "lastBriefAt": _state["last_brief_at"],
        "ticks": _state["ticks"],
        "sync": _sync.get(ws) if ws else None,
    }


def set_enabled(enabled: bool) -> None:
    """Toggle auto-sync at runtime (session-level; resets to HEARTBEAT_ENABLED on
    restart). Manual 'Pull now' still works when auto is off."""
    _state["enabled"] = enabled


async def _summarize(db, ws: str) -> dict:
    async def one(q):
        return (await db.execute(q)).scalar_one()
    return {
        "issues": await one(select(func.count()).select_from(Artifact).where(
            Artifact.workspace_id == ws, Artifact.source == "linear-issue")),
        "calls": await one(select(func.count()).select_from(Artifact).where(
            Artifact.workspace_id == ws, Artifact.source.in_(["call", "document"]))),
        "customers": await one(select(func.count()).select_from(Entity).where(
            Entity.workspace_id == ws, Entity.kind == "customer")),
        "commitments": await one(select(func.count()).select_from(Entity).where(
            Entity.workspace_id == ws, Entity.kind == "commitment")),
        "findings": await one(select(func.count()).select_from(Insight).where(
            Insight.workspace_id == ws, Insight.status == "open",
            Insight.kind.in_(["gap", "trend", "drift", "win"]))),
    }


def _done_message(s: dict) -> str:
    parts = []
    for key, label in (("issues", "issues"), ("calls", "calls"), ("customers", "customers"),
                       ("commitments", "commitments"), ("findings", "findings")):
        if s.get(key):
            parts.append(f"{s[key]} {label}")
    return f"Analysed {', '.join(parts)}" if parts else "Nothing to analyse yet — connect a tool or add a call."


async def run_now(workspace_id: str, trigger: str = "manual") -> None:
    """Run the full Observe → Reason path immediately (not on the next tick) and
    stream coarse progress into `_sync` for the UI. Uses its own DB session."""
    if _sync.get(workspace_id, {}).get("active"):
        return  # a sync is already in flight; don't stack
    _sync[workspace_id] = {
        "active": True, "phase": "reading", "trigger": trigger,
        "message": "Reading everything from your connected tools…",
        "counts": {}, "startedAt": datetime.now(timezone.utc).isoformat(), "finishedAt": None,
    }
    try:
        async with SessionLocal() as db:
            counts = await pull_all(db, workspace_id)
            _sync[workspace_id].update(
                phase="reasoning",
                message="Building your company model and reasoning across it…",
                counts={"issues": counts.get("linear", 0)})
            await backfill_embeddings(db, workspace_id)  # embed anything not yet vectorized
            await detect_findings(db, workspace_id)
            signal_count = (await db.execute(select(func.count()).select_from(Artifact)
                            .where(Artifact.workspace_id == workspace_id))).scalar_one()
            if signal_count:
                await generate_brief(db, workspace_id)
                _state["last_brief_at"] = datetime.now(timezone.utc).isoformat()
            # Act: autonomously draft proposals for new high-priority findings (human reviews).
            await dispatch_for_workspace(db, workspace_id)
            await db.commit()
            summary = await _summarize(db, workspace_id)
        _sync[workspace_id].update(active=False, phase="done", counts=summary,
                                   message=_done_message(summary),
                                   finishedAt=datetime.now(timezone.utc).isoformat())
        _state["last_run_at"] = datetime.now(timezone.utc).isoformat()
    except Exception:
        logger.exception("immediate sync failed")
        _sync[workspace_id].update(active=False, phase="error",
                                   message="Sync hit an error; the heartbeat will retry shortly.",
                                   finishedAt=datetime.now(timezone.utc).isoformat())


def start_sync(workspace_id: str, trigger: str = "manual") -> None:
    """Fire-and-forget an immediate sync (safe to call from a request handler)."""
    asyncio.get_event_loop().create_task(run_now(workspace_id, trigger))


async def _brief_is_stale(db, ws: str) -> bool:
    latest = (await db.execute(
        select(Insight.created_at).where(
            Insight.workspace_id == ws, Insight.kind == "brief", Insight.origin == "model")
        .order_by(Insight.created_at.desc()).limit(1))).scalar_one_or_none()
    if latest is None:
        return True
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - latest > timedelta(days=settings.brief_max_age_days)


async def _tick() -> None:
    async with SessionLocal() as db:
        workspaces = (await db.execute(select(Workspace.id))).scalars().all() or ["ws_default"]
        total_found = 0
        for ws in workspaces:
            # An immediate sync (connect / "Scan now") is already doing this work;
            # skip to avoid double work and write contention.
            if _sync.get(ws, {}).get("active"):
                continue
            # Observe: auto-pull new artifacts from every connected sensor, then reason.
            try:
                await pull_all(db, ws)
            except Exception:
                logger.warning("auto-pull failed; reasoning on existing memory", exc_info=True)
            try:
                await backfill_embeddings(db, ws)  # keep the vector index populated
            except Exception:
                logger.warning("embedding backfill failed; continuing", exc_info=True)
            open_findings = await detect_findings(db, ws)
            total_found += open_findings

            signal_count = (await db.execute(
                select(func.count()).select_from(Artifact).where(Artifact.workspace_id == ws)
            )).scalar_one()
            if signal_count and await _brief_is_stale(db, ws):
                await generate_brief(db, ws)
                _state["last_brief_at"] = datetime.now(timezone.utc).isoformat()

            # Act: draft proposals for new high-priority findings (bounded per tick).
            try:
                await dispatch_for_workspace(db, ws)
            except Exception:
                logger.warning("proposal dispatch failed; continuing", exc_info=True)

            if open_findings:
                db.add(ActivityEvent(
                    id=f"ac_{uuid.uuid4().hex[:8]}",
                    actor={"name": "Orbit", "isAgent": True}, action="scanned",
                    target=f"{open_findings} open finding(s) after a scheduled scan",
                    target_type="finding", at=datetime.now(timezone.utc),
                ))
        await db.commit()
        _state["last_found"] = total_found

    _state["last_run_at"] = datetime.now(timezone.utc).isoformat()
    _state["ticks"] += 1
    if total_found:
        logger.info("heartbeat: %d new insight(s)", total_found)


async def _run_forever() -> None:
    await asyncio.sleep(_STARTUP_DELAY_S)
    while True:
        try:
            if _state["enabled"]:  # auto-sync toggle (manual pulls bypass this)
                await _tick()
        except Exception:
            logger.exception("heartbeat tick failed; continuing")
        await asyncio.sleep(max(60, settings.heartbeat_interval_minutes * 60))


def start() -> None:
    global _task
    if not settings.heartbeat_enabled or _task is not None:
        return
    _task = asyncio.get_event_loop().create_task(_run_forever())
    logger.info("heartbeat started (every %d min)", settings.heartbeat_interval_minutes)


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
