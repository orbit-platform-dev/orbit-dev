import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from .. import mcp_server
from ..config import settings
from ..deps import Depends, get_current_user, get_db
from ..models import Integration, Workspace
from ..schemas import IntegrationOut
from ..seed import ensure_integrations
from ..services import (
    circleback,
    confluence,
    fireflies,
    github,
    google_drive,
    heartbeat,
    ingestion,
    linear,
    notion,
    slack,
)
from ..services.workspace import get_workspace_id

logger = logging.getLogger("orbit.integrations")

router = APIRouter(prefix="/integrations", tags=["integrations"])


PROVIDERS = {
    "linear": linear,
    "slack": slack,
    "github": github,
    "google-drive": google_drive,
    "notion": notion,
    "confluence": confluence,
}

KEY_PROVIDERS = {
    "linear": linear,
    "github": github,
    "notion": notion,
    "fireflies": fireflies,
    "circleback": circleback,
}

WEBHOOK_FIRST = {"circleback"}

# Built end-to-end but not yet launched — surfaced as roadmap ("coming soon")
# and not connectable via any path. Remove a key here to flip it live.
COMING_SOON = {"fireflies", "circleback", "slack"}


async def _get(db, ws: str, key: str) -> Integration | None:
    return await db.get(Integration, {"workspace_id": ws, "key": key})


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    await ensure_integrations(db, ws)  # seed this workspace's catalog on first access
    rows = (await db.execute(select(Integration).where(Integration.workspace_id == ws))).scalars().all()
    for r in rows:
        prov = PROVIDERS.get(r.key)
        r.oauth_available = bool(prov and prov.oauth_configured() and r.key not in COMING_SOON)
        # Connectable means a path actually works right now: a pasted key, or OAuth
        # whose credentials are configured. An OAuth connector without credentials
        # stays on the roadmap side instead of offering a button that 503s.
        r.connectable = (r.key in KEY_PROVIDERS or r.oauth_available) and r.key not in COMING_SOON
        cred = r.credentials or {}
        r.live_events = bool(cred.get("linearWebhookId") or cred.get("githubHooksWired"))
        # Linear only grants webhook rights with the admin scope, which must be
        # asked for explicitly (it blocks authorization for non-admins otherwise).
        r.can_enable_live = r.key == "linear" and r.status == "connected" and not r.live_events
    return rows


# --- Personal API key / token connect (Linear key, GitHub PAT) ---------------
class ConnectKeyIn(BaseModel):
    apiKey: str


@router.post("/{key}/connect", response_model=IntegrationOut)
async def connect_with_key(
    key: str, body: ConnectKeyIn, db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)
):
    """Connect with a pasted personal key/token — validated live, stored per workspace."""
    if key in COMING_SOON:
        raise HTTPException(404, "This integration isn't available yet")
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

    integ.credentials = {**(integ.credentials or {}), "apiKey": token}
    integ.status = "connected"
    integ.account = account
    integ.last_sync = datetime.now(timezone.utc)
    await ingestion.set_source_stale(db, ws, key, False)
    await db.commit()
    await db.refresh(integ)
    await _auto_register_webhook(db, integ, key)
    heartbeat.start_sync(ws, f"{key}-connect")
    return integ


async def _auto_register_webhook(db, integ, key: str) -> None:
    """Zero-plumbing webhooks: on connect, Orbit registers its own webhook in the
    customer's tool via its API — URL, events and signing secret included, no
    manual steps. Best-effort: needs a public HTTPS base; without one (bare dev)
    polling covers everything."""
    if key not in ("linear", "github"):
        return
    base = str(settings.public_api_url or "").rstrip("/")
    if not base.startswith("https://"):
        return
    try:
        cred = dict(integ.credentials or {})
        if not cred.get("webhookToken"):
            cred["webhookToken"] = secrets.token_urlsafe(24)
        url = f"{base}/webhooks/{key}?token={cred['webhookToken']}"
        if key == "linear":
            auth = await linear.get_auth(db, integ.workspace_id)
            if not auth:
                return
            hook_id = await linear.register_webhook(auth, url, cred["webhookToken"])
            if hook_id:
                cred["linearWebhookSecret"] = cred["webhookToken"]
                cred["linearWebhookId"] = hook_id
        else:
            auth = await github.get_auth(db, integ.workspace_id)
            if not auth:
                return
            cred["githubHooksWired"] = await github.register_webhooks(auth, url, cred["webhookToken"])
        integ.credentials = cred
        await db.commit()
    except Exception:
        logger.warning("%s webhook auto-registration skipped", key, exc_info=True)


# --- Generic OAuth (Linear, Slack, …), tenant-safe --------------------------
class OAuthUrlOut(BaseModel):
    url: str


@router.post("/{key}/oauth/url", response_model=OAuthUrlOut)
async def oauth_url(
    key: str,
    admin: bool = False,
    db=Depends(get_db),
    ws: str = Depends(get_workspace_id),
    _=Depends(get_current_user),
):
    """Mint the provider's authorize URL with a workspace-bound `state`. The
    workspace comes from the signed-in user (never a query param); the callback
    reads it back from `state`, so an unauthenticated browser redirect can never
    land a connection in the wrong tenant.

    `admin=true` requests the extra scope that lets Orbit create the webhook for
    live updates. Only offer it to users the tool reports as admins: Linear
    refuses the whole authorization for everyone else."""
    if key in COMING_SOON:
        raise HTTPException(404, "This integration isn't available yet")
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
    state = f"{ws}.{nonce}"
    # Only Linear distinguishes an admin scope; others ignore the flag.
    url = prov.oauth_url(state, admin=True) if (admin and key == "linear") else prov.oauth_url(state)
    return OAuthUrlOut(url=url)


@router.get("/{key}/oauth/callback")
async def oauth_callback(
    key: str, code: str | None = None, state: str | None = None, error: str | None = None, db=Depends(get_db)
):
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
    await _auto_register_webhook(db, integ, key)
    heartbeat.start_sync(ws, f"{key}-connect")
    return RedirectResponse(f"{dest}?connected={key}")


class WebhookUrlOut(BaseModel):
    url: str
    note: str


@router.get("/{key}/webhook", response_model=WebhookUrlOut)
async def webhook_url(key: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    """Mint (once) and return this workspace's inbound webhook URL for a
    connector. Paste it into the provider's webhook settings; for GitHub also
    set the token as the hook secret (enables HMAC verification)."""
    if key in COMING_SOON:
        raise HTTPException(404, "This integration isn't available yet")
    if key not in PROVIDERS and key not in KEY_PROVIDERS:
        raise HTTPException(404, "Integration not found")
    integ = await _get(db, ws, key)
    if not integ:
        raise HTTPException(404, "Integration not found")
    # Webhook-first connectors (Circleback) need the URL BEFORE connecting — the
    # provider generates the signing secret from it. Everything else connects first.
    if key not in WEBHOOK_FIRST and integ.status != "connected":
        raise HTTPException(409, f"Connect {key} first")
    cred = dict(integ.credentials or {})
    if not cred.get("webhookToken"):
        cred["webhookToken"] = secrets.token_urlsafe(24)
        integ.credentials = cred
        await db.commit()
    base = str(settings.public_api_url or "http://localhost:8000").rstrip("/")
    notes = {
        "github": "GitHub: also set this token as the webhook secret.",
        "circleback": "Circleback → Automations → Send webhook request: paste this URL, "
        "then copy the signing secret Circleback gives you and connect it here.",
    }
    return WebhookUrlOut(
        url=f"{base}/webhooks/{key}?token={cred['webhookToken']}",
        note=(
            notes.get(key, "Paste this URL into the provider's webhook settings.")
            + " Dev needs a public URL (e.g. ngrok)."
        ),
    )


@router.post("/{key}/disconnect", response_model=IntegrationOut)
async def disconnect(key: str, db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    if key not in PROVIDERS and key not in KEY_PROVIDERS:
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


# --- MCP: this workspace's key for external AI agents (Claude Code, Cursor) --
def _mcp_endpoint() -> str:
    return f"{(settings.public_api_url or 'http://localhost:8000').rstrip('/')}/mcp"


@router.get("/mcp")
async def mcp_status(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    row = await db.get(Workspace, ws)
    return {"configured": bool(row and row.mcp_key_hash), "endpoint": _mcp_endpoint()}


@router.post("/mcp/key")
async def mcp_generate_key(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    """Generate (or rotate) this workspace's MCP key. The key is the tenant
    credential — /mcp resolves the workspace from it. Stored hashed; the
    plaintext is returned ONCE and cannot be recovered, only rotated."""
    row = await db.get(Workspace, ws)
    if not row:
        raise HTTPException(404, "Workspace not found")
    key = f"orbit_mcp_{secrets.token_hex(20)}"
    row.mcp_key_hash = mcp_server.hash_key(key)
    await db.commit()
    return {
        "key": key,
        "endpoint": _mcp_endpoint(),
        "command": (f'claude mcp add --transport http orbit {_mcp_endpoint()} --header "Authorization: Bearer {key}"'),
    }


@router.delete("/mcp/key")
async def mcp_revoke_key(db=Depends(get_db), ws: str = Depends(get_workspace_id), _=Depends(get_current_user)):
    row = await db.get(Workspace, ws)
    if row:
        row.mcp_key_hash = None
        await db.commit()
    return {"configured": False, "endpoint": _mcp_endpoint()}
