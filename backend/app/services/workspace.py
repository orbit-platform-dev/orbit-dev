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
    # Clerk org claim when auth is enabled; the demo principal has none.
    return user.get("org_id") or DEFAULT_WORKSPACE_ID


async def get_workspace_id(user: dict[str, Any] = Depends(get_current_user)) -> str:
    return workspace_id_for(user)


async def ensure_default_workspace(db) -> None:
    if not await db.get(Workspace, DEFAULT_WORKSPACE_ID):
        db.add(Workspace(id=DEFAULT_WORKSPACE_ID, name="Orbit Workspace",
                         created_at=datetime.now(timezone.utc)))
        await db.flush()
