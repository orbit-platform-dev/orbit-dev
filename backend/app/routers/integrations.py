import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from ..config import settings
from ..deps import Depends, get_current_user, get_db
from ..models import Integration
from ..schemas import IntegrationOut
from ..seed import ensure_integrations
from ..services import github, google_drive, heartbeat, ingestion, linear, slack
from ..services.workspace import get_workspace_id

router = APIRouter(prefix="/integrations", tags=["integrations"])

# OAuth-capable connectors, each exposing the same interface
# (oauth_configured / oauth_url / exchange_code / account_name). Every access is
# scoped to a workspace, so one tenant never sees another's connection.
PROVIDERS = {"linear": linear, "slack": slack, "github": github, "google-drive": google_drive}

# Connectors that also accept a pasted personal key/token (validate_key).
KEY_PROVIDERS = {"linear": linear, "github": github}


async def _get(db, ws: str, key: str) -> Integration | None:
    return await db.get(Integration, {"workspace_id": ws, "key": key})


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    await ensure_integrations(db, ws)  # seed this workspace's catalog on first access
    rows = (await db.execute(select(Integration).where(Integration.workspace_id == ws))).scalars().all()
    for r in rows:
        prov = PROVIDERS.get(r.key)
        r.connectable = prov is not None
        r.oauth_available = bool(prov and prov.oauth_configured())
    return rows


# --- Personal API key / token connect (Linear key, GitHub PAT) ---------------
class ConnectKeyIn(BaseModel):
    apiKey: str


@router.post("/{key}/connect", response_model=IntegrationOut)
async def connect_with_key(key: str, body: ConnectKeyIn, db=Depends(get_db),
                           ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    """Connect with a pasted personal key/token — validated live, stored per workspace."""
    prov = KEY_PROVIDERS.get(key)
    if not prov:
        raise HTTPException(404, "This integration doesn't accept an API key")
    token = body.apiKey.strip()
    if not token:
        raise HTTPException(422, "API key is required")
    try:
        account = await prov.validate_key(token)
    except Exception as exc:
        raise HTTPException(422, f"{key.capitalize()} rejected the key: {exc}")
    await ensure_integrations(db, ws)
    integ = await _get(db, ws, key)
    if not integ:
        raise HTTPException(404, "Integration not found")
    integ.credentials = {"apiKey": token}
    integ.status = "connected"
    integ.account = account
    integ.last_sync = datetime.now(timezone.utc)
    await ingestion.set_source_stale(db, ws, key, False)
    await db.commit()
    await db.refresh(integ)
    heartbeat.start_sync(ws, f"{key}-connect")
    return integ


# --- Generic OAuth (Linear, Slack, …), tenant-safe --------------------------
class OAuthUrlOut(BaseModel):
    url: str


@router.post("/{key}/oauth/url", response_model=OAuthUrlOut)
async def oauth_url(key: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    """Mint the provider's authorize URL with a workspace-bound `state`. The
    workspace comes from the signed-in user (never a query param); the callback
    reads it back from `state`, so an unauthenticated browser redirect can never
    land a connection in the wrong tenant."""
    prov = PROVIDERS.get(key)
    if not prov or not prov.oauth_configured():
        raise HTTPException(503, f"{key} OAuth is not configured.")
    await ensure_integrations(db, ws)
    integ = await _get(db, ws, key)
    if not integ:
        raise HTTPException(404, "Integration not found")
    nonce = secrets.token_urlsafe(24)
    integ.credentials = {**(integ.credentials or {}), "oauthState": nonce}
    await db.commit()
    return OAuthUrlOut(url=prov.oauth_url(f"{ws}.{nonce}"))


@router.get("/{key}/oauth/callback")
async def oauth_callback(key: str, code: str | None = None, state: str | None = None,
                         error: str | None = None, db=Depends(get_db)):
    prov = PROVIDERS.get(key)
    dest = f"{settings.frontend_url}/integrations"
    if not prov or error or not code or not state or "." not in state:
        return RedirectResponse(f"{dest}?error={key}")
    ws, nonce = state.split(".", 1)  # workspace is carried in the signed-at-start state
    integ = await _get(db, ws, key)
    stored = (integ.credentials or {}).get("oauthState") if integ else None
    if not integ or not stored or nonce != stored:
        return RedirectResponse(f"{dest}?error=state")
    try:
        # Google returns a credential dict (access+refresh+expiry); others a bare token.
        token = await prov.exchange_code(code)
        cred = token if isinstance(token, dict) else {"accessToken": token}
        account = await prov.account_name(f"Bearer {cred['accessToken']}")
    except Exception:
        return RedirectResponse(f"{dest}?error=exchange")
    integ.credentials = {**cred, "type": "oauth"}
    integ.status = "connected"
    integ.account = account
    integ.last_sync = datetime.now(timezone.utc)
    await ingestion.set_source_stale(db, ws, key, False)
    await db.commit()
    heartbeat.start_sync(ws, f"{key}-connect")
    return RedirectResponse(f"{dest}?connected={key}")


class WebhookUrlOut(BaseModel):
    url: str
    note: str


@router.get("/{key}/webhook", response_model=WebhookUrlOut)
async def webhook_url(key: str, db=Depends(get_db), ws: str = Depends(get_workspace_id),
                      _=Depends(get_current_user)):
    """Mint (once) and return this workspace's inbound webhook URL for a
    connector. Paste it into the provider's webhook settings; for GitHub also
    set the token as the hook secret (enables HMAC verification)."""
    if key not in PROVIDERS:
        raise HTTPException(404, "Integration not found")
    integ = await _get(db, ws, key)
    if not integ or integ.status != "connected":
        raise HTTPException(409, f"Connect {key} first")
    cred = dict(integ.credentials or {})
    if not cred.get("webhookToken"):
        cred["webhookToken"] = secrets.token_urlsafe(24)
        integ.credentials = cred
        await db.commit()
    base = str(settings.public_api_url or "http://localhost:8000").rstrip("/")
    return WebhookUrlOut(
        url=f"{base}/webhooks/{key}?token={cred['webhookToken']}",
        note="GitHub: also set this token as the webhook secret. Dev needs a public URL (e.g. ngrok).",
    )


@router.post("/{key}/disconnect", response_model=IntegrationOut)
async def disconnect(key: str, db=Depends(get_db), ws: str = Depends(get_workspace_id),
                     _=Depends(get_current_user)):
    if key not in PROVIDERS:
        raise HTTPException(404, "Integration not found")
    integ = await _get(db, ws, key)
    if not integ:
        raise HTTPException(404, "Integration not found")
    integ.credentials = None
    integ.status = "disconnected"
    integ.account = None
    integ.last_sync = None
    # Keep the memory as history, flagged 'no longer syncing' (never silently deleted).
    await ingestion.set_source_stale(db, ws, key, True)
    await db.commit()
    await db.refresh(integ)
    return integ
