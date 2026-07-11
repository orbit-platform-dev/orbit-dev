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
from ..models import ActivityEvent, Insight, Meeting, Workspace
from .insights import detect_insights, generate_brief

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


def status() -> dict:
    # camelCase to match the API's serialization convention.
    return {
        "enabled": _state["enabled"],
        "intervalMinutes": _state["interval_minutes"],
        "lastRunAt": _state["last_run_at"],
        "lastFound": _state["last_found"],
        "lastBriefAt": _state["last_brief_at"],
        "ticks": _state["ticks"],
    }


async def _brief_is_stale(db, ws: str) -> bool:
    latest = (await db.execute(
        select(Insight.created_at).where(Insight.workspace_id == ws, Insight.kind == "brief")
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
            found = await detect_insights(db, ws)
            total_found += len(found)

            signal_count = (await db.execute(
                select(func.count()).select_from(Meeting).where(Meeting.workspace_id == ws)
            )).scalar_one()
            if signal_count and await _brief_is_stale(db, ws):
                await generate_brief(db, ws)
                _state["last_brief_at"] = datetime.now(timezone.utc).isoformat()

            if found:
                db.add(ActivityEvent(
                    id=f"ac_{uuid.uuid4().hex[:8]}",
                    actor={"name": "Orbit", "isAgent": True}, action="detected",
                    target=f"{len(found)} new insight(s) in a scheduled scan",
                    target_type="insight", at=datetime.now(timezone.utc),
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
