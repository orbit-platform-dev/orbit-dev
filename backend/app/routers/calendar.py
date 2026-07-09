"""Google Calendar integration — real OAuth, no mocks.

Flow: GET /calendar/connect returns Google's consent URL → the browser lands on
GET /calendar/oauth/callback → we exchange the code for tokens, store them, and
bounce back to the app's Calendar tab.

Strictly READ-ONLY: events are created and owned in the user's own calendar
apps, which stay the system of record. Orbit only syncs upcoming events so the
Calendar tab and "Starting soon" strip can show them — it never writes to the
invite or replaces the meeting link.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from ..config import settings
from ..deps import Depends, get_current_user, get_db
from ..models import CalendarConnection, Integration

router = APIRouter(prefix="/calendar", tags=["calendar"])

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
_SCOPES = "openid email https://www.googleapis.com/auth/calendar.events.readonly"

_SETUP_HINT = (
    "Google Calendar isn't configured. Create an OAuth client (Web application) in "
    "Google Cloud Console, add the redirect URI "
    f"{settings.google_redirect_uri}, then set GOOGLE_CLIENT_ID and "
    "GOOGLE_CLIENT_SECRET in backend/.env and restart the API."
)


def _configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


async def _connection(db) -> CalendarConnection | None:
    return await db.get(CalendarConnection, "google")


async def _access_token(db) -> str:
    """Current access token, refreshed via the refresh token when expired."""
    conn = await _connection(db)
    if not conn:
        raise HTTPException(409, "Google Calendar is not connected")
    now = datetime.now(timezone.utc)
    expiry = conn.token_expiry
    if expiry is not None and expiry.tzinfo is None:  # SQLite drops tzinfo
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry and expiry > now + timedelta(seconds=60):
        return conn.access_token
    if not conn.refresh_token:
        raise HTTPException(409, "Google session expired — reconnect Google Calendar")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(_TOKEN_URL, data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": conn.refresh_token,
            "grant_type": "refresh_token",
        })
    if res.status_code != 200:
        raise HTTPException(502, f"Google token refresh failed: {res.text[:200]}")
    tok = res.json()
    conn.access_token = tok["access_token"]
    conn.token_expiry = now + timedelta(seconds=int(tok.get("expires_in", 3600)))
    await db.commit()
    return conn.access_token


async def _set_integration_row(db, *, connected: bool, email: str = "") -> None:
    integ = await db.get(Integration, "calendar")
    if integ:
        integ.status = "connected" if connected else "disconnected"
        integ.account = email or None
        integ.last_sync = datetime.now(timezone.utc) if connected else None


# --- Connection lifecycle -----------------------------------------------------
@router.get("/status")
async def calendar_status(db=Depends(get_db), _=Depends(get_current_user)):
    conn = await _connection(db)
    return {
        "configured": _configured(),
        "connected": bool(conn),
        "email": conn.email if conn else None,
    }


@router.get("/connect")
async def calendar_connect(_=Depends(get_current_user)):
    """Return the Google consent URL the browser should navigate to."""
    if not _configured():
        raise HTTPException(503, _SETUP_HINT)
    params = httpx.QueryParams({
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": _SCOPES,
        "access_type": "offline",   # get a refresh token
        "prompt": "consent",        # always re-issue the refresh token
    })
    return {"url": f"{_AUTH_URL}?{params}"}


@router.get("/oauth/callback")
async def calendar_oauth_callback(code: str | None = None, error: str | None = None, db=Depends(get_db)):
    """Google redirects the browser here; exchange the code and bounce to the app."""
    front = f"{settings.frontend_url.rstrip('/')}/calendar"
    if error or not code:
        return RedirectResponse(f"{front}?calendar=error&reason={error or 'no_code'}")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
        })
        if res.status_code != 200:
            return RedirectResponse(f"{front}?calendar=error&reason=token_exchange")
        tok = res.json()
        info = await client.get(_USERINFO_URL, headers={"Authorization": f"Bearer {tok['access_token']}"})
        email = info.json().get("email", "") if info.status_code == 200 else ""

    now = datetime.now(timezone.utc)
    conn = await _connection(db)
    if not conn:
        conn = CalendarConnection(id="google", connected_at=now)
        db.add(conn)
    conn.email = email
    conn.access_token = tok["access_token"]
    # Google only returns refresh_token on the first consent; keep the old one otherwise.
    conn.refresh_token = tok.get("refresh_token") or conn.refresh_token
    conn.token_expiry = now + timedelta(seconds=int(tok.get("expires_in", 3600)))
    conn.scopes = tok.get("scope", _SCOPES)
    await _set_integration_row(db, connected=True, email=email)
    await db.commit()
    return RedirectResponse(f"{front}?calendar=connected")


@router.post("/disconnect")
async def calendar_disconnect(db=Depends(get_db), _=Depends(get_current_user)):
    conn = await _connection(db)
    if conn:
        try:  # best-effort revoke; disconnecting locally must always succeed
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(_REVOKE_URL, params={"token": conn.refresh_token or conn.access_token})
        except httpx.HTTPError:
            pass
        await db.delete(conn)
    await _set_integration_row(db, connected=False)
    await db.commit()
    return {"connected": False}


# --- Events --------------------------------------------------------------------
def _event_time(block: dict) -> str | None:
    return block.get("dateTime") or block.get("date")


def _event_out(ev: dict) -> dict:
    return {
        "id": ev["id"],
        "title": ev.get("summary", "(no title)"),
        "start": _event_time(ev.get("start", {})),
        "end": _event_time(ev.get("end", {})),
        "attendees": [
            {"email": a.get("email", ""), "name": a.get("displayName") or a.get("email", "")}
            for a in ev.get("attendees", []) if not a.get("resource")
        ],
        "meetLink": ev.get("hangoutLink"),
        "htmlLink": ev.get("htmlLink"),
    }


@router.get("/events")
async def list_events(time_min: str | None = None, days: int = 7,
                      db=Depends(get_db), _=Depends(get_current_user)):
    """Events in a window (read-only — events are created in the user's calendar
    apps). `time_min` (ISO, default now) + `days` let the week view page back
    and forth like Google Calendar."""
    token = await _access_token(db)
    days = min(max(days, 1), 31)
    try:
        window_start = datetime.fromisoformat(time_min) if time_min else datetime.now(timezone.utc)
    except ValueError:
        raise HTTPException(422, "time_min must be an ISO datetime")
    if window_start.tzinfo is None:  # Google requires an offset
        window_start = window_start.replace(tzinfo=timezone.utc)
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(_EVENTS_URL, params={
            "timeMin": window_start.isoformat(),
            "timeMax": (window_start + timedelta(days=days)).isoformat(),
            "singleEvents": "true", "orderBy": "startTime", "maxResults": 100,
        }, headers={"Authorization": f"Bearer {token}"})
        if res.status_code != 200:
            raise HTTPException(502, f"Google Calendar error: {res.text[:200]}")
        items = [ev for ev in res.json().get("items", []) if ev.get("status") != "cancelled"]

    return [_event_out(ev) for ev in items]
