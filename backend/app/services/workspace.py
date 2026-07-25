"""Workspace resolution — the tenancy seam.

Every business row carries workspace_id. Until Clerk organizations are wired in,
all traffic lands on the seeded default workspace; the dependency below is the
single place that changes when real org claims arrive.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Depends

from ..deps import get_current_user, get_db
from ..models import Workspace

DEFAULT_WORKSPACE_ID = "ws_default"


def active_org_id(user: dict[str, Any]) -> str | None:
    """The active Clerk organization id from a verified token, or None.

    Clerk v2 session tokens carry the org in a compact `o` claim
    (`{"o": {"id": "org_...", "rol": "admin"}}`); older/templated tokens use a
    flat `org_id`. We must read both — reading only `org_id` silently collapses
    every org onto the personal bucket (a cross-tenant data leak)."""
    org = user.get("org_id")
    if org:
        return org
    o = user.get("o")
    if isinstance(o, dict) and o.get("id"):
        return o["id"]
    return None


def workspace_id_for(user: dict[str, Any]) -> str:
    """Resolve the caller's workspace (tenant). Isolation by default:

    - A Clerk **organization** is a customer's shared workspace → its id.
      This is the founders' model: an invited customer gets their own org, and
      everyone they invite into it shares that one Orbit workspace.
    - An authenticated user with **no active org** gets their own personal
      workspace (`user_<id>`), never a shared bucket.
    - Only the demo principal (auth disabled in dev) lands on the default.
    """
    org = active_org_id(user)
    if org:
        return org
    sub = user.get("sub")
    if sub and sub != "demo_user":
        return f"user_{sub}"
    return DEFAULT_WORKSPACE_ID


async def get_workspace_id(user: dict[str, Any] = Depends(get_current_user), db=Depends(get_db)) -> str:
    """Resolve the tenant AND materialize its Workspace row on first sight.
    Without the row, per-workspace state (auto_sync, embedding_model) and the
    heartbeat's workspace scan silently miss the tenant."""
    ws = workspace_id_for(user)
    if not await db.get(Workspace, ws):
        try:
            db.add(Workspace(id=ws, name=ws, created_at=datetime.now(timezone.utc)))
            await db.commit()
        except Exception:  # concurrent first request already inserted it
            await db.rollback()
    return ws


async def ensure_workspace_rows(db) -> None:
    """Startup self-heal: older DBs created business rows under org/user
    workspace ids without ever inserting the Workspace row. Materialize the
    missing ones so heartbeat scans and per-workspace state cover every tenant."""
    from sqlalchemy import select

    from ..models import Artifact

    known = set((await db.execute(select(Workspace.id))).scalars().all())
    seen = set((await db.execute(select(Artifact.workspace_id).distinct())).scalars().all())
    missing = sorted(ws for ws in (seen - known) if ws)
    for ws in missing:
        db.add(Workspace(id=ws, name=ws, created_at=datetime.now(timezone.utc)))
    if missing:
        await db.commit()


async def ensure_default_workspace(db) -> None:
    if not await db.get(Workspace, DEFAULT_WORKSPACE_ID):
        db.add(Workspace(id=DEFAULT_WORKSPACE_ID, name="Orbit Workspace", created_at=datetime.now(timezone.utc)))
        await db.flush()
