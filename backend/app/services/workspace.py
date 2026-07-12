"""Workspace resolution — the tenancy seam.

Every business row carries workspace_id. Until Clerk organizations are wired in,
all traffic lands on the seeded default workspace; the dependency below is the
single place that changes when real org claims arrive.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Depends

from ..deps import get_current_user
from ..models import Workspace

DEFAULT_WORKSPACE_ID = "ws_default"


def workspace_id_for(user: dict[str, Any]) -> str:
    """Resolve the caller's workspace (tenant). Isolation by default:

    - A Clerk **organization** is a customer's shared workspace → its `org_id`.
      This is the founders' model: an invited customer gets their own org, and
      everyone they invite into it shares that one Orbit workspace.
    - An authenticated user with **no active org** gets their own personal
      workspace (`user_<id>`), never a shared bucket.
    - Only the demo principal (auth disabled in dev) lands on the default.
    """
    org = user.get("org_id")
    if org:
        return org
    sub = user.get("sub")
    if sub and sub != "demo_user":
        return f"user_{sub}"
    return DEFAULT_WORKSPACE_ID


async def get_workspace_id(user: dict[str, Any] = Depends(get_current_user)) -> str:
    return workspace_id_for(user)


async def ensure_default_workspace(db) -> None:
    if not await db.get(Workspace, DEFAULT_WORKSPACE_ID):
        db.add(Workspace(id=DEFAULT_WORKSPACE_ID, name="Orbit Workspace",
                         created_at=datetime.now(timezone.utc)))
        await db.flush()
