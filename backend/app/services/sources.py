"""Which artifact sources a workspace is allowed to see.

Memory must reflect only tools the workspace has actually connected — never a
coming-soon or disconnected connector's leftover rows. Both the Memory browser
and the chat agent filter through here so the guarantee holds everywhere.
"""

from __future__ import annotations

from sqlalchemy import select

from ..models import Integration

_SOURCE_CONNECTOR = {
    "linear": "linear",
    "github": "github",
    "slack": "slack",
    "gdrive": "google-drive",
    "fireflies": "fireflies",
    "circleback": "circleback",
    "notion": "notion",
    "zoom": "zoom",
    "meet": "google-meet",
}
_MANUAL_SOURCES = {"call", "document"}


async def connected_keys(db, ws: str) -> set[str]:
    return set(
        (
            await db.execute(
                select(Integration.key).where(Integration.workspace_id == ws, Integration.status == "connected")
            )
        )
        .scalars()
        .all()
    )


def source_visible(source: str, connected: set[str]) -> bool:
    if (source or "") in _MANUAL_SOURCES:
        return True
    connector = _SOURCE_CONNECTOR.get((source or "").split("-", 1)[0])
    return connector is None or connector in connected
