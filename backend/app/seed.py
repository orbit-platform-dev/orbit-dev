"""The connector catalog.

Linear and Slack are real, connectable sensors; everything else is surfaced
honestly as on-the-roadmap. Which rows are actually connectable is decided at
runtime by the router's PROVIDERS registry, not by this status string.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models


def _baseline_integrations(workspace_id: str) -> list:
    def integ(**kw):
        return models.Integration(workspace_id=workspace_id, **kw)
    return [
        integ(key="linear", name="Linear", category="Engineering",
              description="Read issues into memory and create issues from approved recommendations.",
              status="disconnected"),
        integ(key="github", name="GitHub", category="Engineering",
              description="Pull requests and issues as code-execution reality.",
              status="disconnected"),
        integ(key="slack", name="Slack", category="Communication",
              description="Threads from the channels you add the Orbit bot to, as company context.",
              status="disconnected"),
        integ(key="notion", name="Notion", category="Product", description="Docs as company context.", status="coming-soon"),
        integ(key="google-meet", name="Google Meet", category="Conferencing", description="Call transcripts as signals.", status="coming-soon"),
        integ(key="zoom", name="Zoom", category="Conferencing", description="Call transcripts as signals.", status="coming-soon"),
        integ(key="salesforce", name="Salesforce", category="CRM", description="Accounts and deals as context.", status="coming-soon"),
        integ(key="hubspot", name="HubSpot", category="CRM", description="Accounts and deals as context.", status="coming-soon"),
    ]


async def ensure_integrations(db: AsyncSession, workspace_id: str = "ws_default") -> None:
    """Backfill any missing connector rows for a workspace so its catalog is
    always present. Called at startup for the default workspace and on first
    access for any new one, so every tenant gets its own isolated catalog."""
    existing = set((await db.execute(
        select(models.Integration.key).where(models.Integration.workspace_id == workspace_id)
    )).scalars().all())
    missing = [i for i in _baseline_integrations(workspace_id) if i.key not in existing]
    if missing:
        db.add_all(missing)
        await db.commit()
