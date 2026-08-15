"""Short-lived credentials for Orbit's desktop voice client.

The Deepgram project API key never leaves this backend. The desktop main process
receives a one-use, 30-second token immediately before opening its STT socket.
"""

from __future__ import annotations

import logging
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..config import settings
from ..deps import get_current_user
from ..services.workspace import get_workspace_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice", tags=["voice"])

_last_issued: dict[str, float] = {}


class DeepgramTokenOut(BaseModel):
    token: str
    expires_in: int


@router.post("/deepgram-token", response_model=DeepgramTokenOut)
async def deepgram_token(ws: str = Depends(get_workspace_id), user: dict = Depends(get_current_user)):
    """Issue an immediately-expiring STT credential for the authenticated workspace."""
    if not settings.deepgram_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Voice transcription is not configured.")

    key = f"{ws}:{user.get('sub') or 'unknown'}"
    now = time.monotonic()
    if now - _last_issued.get(key, 0) < 1:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Please wait a moment before starting voice again.")
    _last_issued[key] = now

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                "https://api.deepgram.com/v1/auth/grant",
                headers={"Authorization": f"Token {settings.deepgram_api_key}"},
            )
        if response.status_code == 403:
            logger.error("Deepgram key lacks the keys:write scope needed to grant temporary tokens")
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "The Deepgram key cannot issue voice tokens. It needs the keys:write scope (Member role or above).",
            )
        if response.status_code == 401:
            logger.error("Deepgram rejected the configured API key")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Voice transcription credentials are invalid.")
        response.raise_for_status()
        body = response.json()
        token = body.get("access_token") if isinstance(body, dict) else None
        expires_in = body.get("expires_in") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token or not isinstance(expires_in, int):
            raise ValueError("missing temporary token fields")
        return DeepgramTokenOut(token=token, expires_in=expires_in)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Deepgram temporary-token request failed", exc_info=True)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Voice transcription service is unavailable.") from exc
