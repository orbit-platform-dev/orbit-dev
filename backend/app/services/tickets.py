"""Ticket creation — the write-actuator seam shared by every surface (chat, Feed).

One place decides how each connector creates an issue and how the created issue
folds back into memory, so a new connector slots in here, not in each caller.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from . import github, linear

logger = logging.getLogger("orbit.tickets")

_SOURCE = {"linear": "linear-issue", "github": "github-issue"}


async def create_ticket(db, ws: str, *, connector: str, title: str, description: str,
                        target: str | None = None) -> dict[str, str]:
    """Create a real issue in `connector` (Linear team id / GitHub owner-repo in
    `target`). Returns {identifier, url}. Raises PermissionError (not connected),
    ValueError (bad target/connector), or the connector's own error (API refusal)."""
    if connector == "github":
        auth = await github.get_auth(db, ws)
        if not auth:
            raise PermissionError("Connect GitHub to create issues")
        if not target:
            raise ValueError("Choose a repository first")
        return await github.create_issue(auth, target, title, description)
    if connector == "linear":
        auth = await linear.get_auth(db, ws)
        if not auth:
            raise PermissionError("Connect Linear to create issues")
        return await linear.create_issue(auth, title, description, team_id=target)
    raise ValueError(f"Unknown connector: {connector}")


async def ingest_created(db, ws: str, connector: str, result: dict, title: str, description: str) -> None:
    """Fold a just-created issue into memory so it's tracked immediately. Idempotent
    by external_ref — the next connector pull refreshes it in place. Caller commits."""
    from .ingestion import ingest_artifact

    await ingest_artifact(
        db, ws, source=_SOURCE.get(connector, "linear-issue"), kind="issue",
        title=f"{result['identifier']} · {title}"[:300],
        content=f"{title}\n\n{description}",
        external_ref=result["identifier"], url=result["url"],
        occurred_at=datetime.now(timezone.utc),
        meta={"identifier": result["identifier"], "state": "open", "stateType": "started",
              "createdInOrbit": True},
    )
