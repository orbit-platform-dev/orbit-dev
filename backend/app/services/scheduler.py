"""Cloud Scheduler control for the auto-sync toggle.

Pauses/resumes the heartbeat job ITSELF, so toggle-off means zero scheduled
calls (no hourly cold starts), not just a skipped tick. SCHEDULER_JOB unset
(dev) -> no-op; the per-workspace auto_sync flag still gates the in-process
loop and any tick that does fire. Single-workspace assumption: any workspace's
toggle drives the one job — revisit before multi-tenant GA.
"""

from __future__ import annotations

import logging

import httpx

from ..config import settings

logger = logging.getLogger("orbit.scheduler")

_METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
_API = "https://cloudscheduler.googleapis.com/v1"


async def _token() -> str | None:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            res = await client.get(_METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"})
        if res.status_code == 200:
            return res.json().get("access_token")
    except Exception:
        pass
    return None


def configured() -> bool:
    return bool(settings.scheduler_job)


async def set_paused(paused: bool) -> bool:
    """Pause or resume the configured job. Best-effort: returns True when the
    API accepted the change, False otherwise (unconfigured, no credentials, or
    API error) — the caller's toggle must succeed either way."""
    if not configured():
        return False
    token = await _token()
    if not token:
        logger.warning("scheduler control skipped: no metadata credentials (not on Cloud Run?)")
        return False
    verb = "pause" if paused else "resume"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                f"{_API}/{settings.scheduler_job}:{verb}",
                headers={"Authorization": f"Bearer {token}"},
            )
        if res.status_code == 200:
            logger.info("scheduler job %sd", verb)
            return True
        logger.warning("scheduler %s failed (%s): %s", verb, res.status_code, res.text[:200])
    except Exception:
        logger.warning("scheduler %s errored", verb, exc_info=True)
    return False
