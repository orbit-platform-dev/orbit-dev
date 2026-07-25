"""Inbound webhooks — push-based sync.

One public endpoint per connector: the provider calls it on change, Orbit
verifies and triggers a debounced INCREMENTAL sync for that workspace (the
cursors make this cheap). Deliberately payload-agnostic: we never parse thirty
event shapes — any verified ping means "something changed, go look".

Auth: a per-workspace random token minted by GET /integrations/{key}/webhook
(the URL itself is the credential). GitHub deliveries are additionally verified
with HMAC-SHA256 when the hook is configured with the token as its secret.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from ..deps import Depends, get_db
from ..models import Integration
from ..services import circleback, heartbeat, ingestion

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

_DEBOUNCE_SECONDS = 30
_last_trigger: dict[str, float] = {}


def _github_signature_ok(token: str, body: bytes, header: str | None) -> bool:
    if not header:
        return True  # token-in-URL is the baseline auth; HMAC is defense-in-depth
    expected = "sha256=" + hmac.new(token.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


@router.post("/{key}")
async def receive(key: str, token: str, request: Request, db=Depends(get_db)):
    body = await request.body()

    # Slack Events API handshake: echo the challenge before anything else.
    if key == "slack" and b'"url_verification"' in body:
        import json

        return {"challenge": json.loads(body).get("challenge", "")}

    integ = (await db.execute(select(Integration).where(Integration.key == key))).scalars().all()
    match = next((i for i in integ if (i.credentials or {}).get("webhookToken") == token), None)
    if not match:
        raise HTTPException(404, "Unknown webhook")
    if key == "github" and not _github_signature_ok(token, body, request.headers.get("X-Hub-Signature-256")):
        raise HTTPException(401, "Bad signature")

    ws = match.workspace_id

    # Circleback PUSHES the whole meeting (there's no API to poll), so this
    # delivery IS the data: verify its signature and ingest the payload directly,
    # rather than triggering a sync like the poll-based connectors.
    if key == "circleback":
        secret = (match.credentials or {}).get("apiKey")
        if not circleback.signature_ok(secret, body, request.headers.get("x-signature")):
            raise HTTPException(401, "Bad signature")
        import json

        ingestion.start_circleback_ingest(ws, json.loads(body))
        return {"ok": True}

    now = time.time()
    if now - _last_trigger.get(ws, 0) >= _DEBOUNCE_SECONDS:
        _last_trigger[ws] = now
        heartbeat.start_sync(ws, f"{key}-webhook")
    return {"ok": True}
