"""Internal, machine-to-machine endpoints — token-authenticated, NOT Clerk.

Lets Cloud Scheduler drive the heartbeat when the app runs scale-to-zero
(HEARTBEAT_ENABLED=false), so there's no always-on instance to pay for.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, status

from ..config import settings
from ..services import heartbeat

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["internal"])


def _authorized(token: str | None) -> bool:
    # No token configured ⇒ endpoint stays disabled (safe by default).
    expected = settings.heartbeat_token
    return bool(expected and token and hmac.compare_digest(token, expected))


@router.post("/heartbeat")
async def run_heartbeat(x_heartbeat_token: str | None = Header(default=None)):
    """Run one heartbeat tick across all workspaces. Point a Cloud Scheduler job
    (every ~30 min) here with the `X-Heartbeat-Token` header. Runs synchronously so
    the request holds the instance alive (CPU allocated) until the scan completes —
    set the scheduler's attempt deadline high enough for a full tick."""
    if not _authorized(x_heartbeat_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid heartbeat token")
    try:
        await heartbeat.run_tick()
    except Exception:
        logger.exception("scheduled heartbeat tick failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Heartbeat tick failed")
    return {"ok": True}
