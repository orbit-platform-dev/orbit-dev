"""Google Calendar integration — real OAuth, no mocks.

Flow: GET /calendar/connect returns Google's consent URL → the browser lands on
GET /calendar/oauth/callback → we exchange the code for tokens, store them, and
bounce back to the app's Calendar tab.

Orbit is the meeting platform, not a bolt-on. Events are created in the user's
own calendar apps (attendees span companies) — Orbit only reads them. With
auto-link ON (default), every upcoming meeting gets an Orbit call link written
into the invite as events sync, and the Google Meet conference is REPLACED so
every invited party sees one link: Orbit's. Where Google forbids the edit
(attendee on someone else's event), the room still exists and the response says
so (`linkedInInvite: false`) — the UI offers the link to copy.

"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ..config import settings
from ..deps import Depends, get_current_user, get_db
from ..models import CalendarConnection, CallRoom, Integration

router = APIRouter(prefix="/calendar", tags=["calendar"])
logger = logging.getLogger("orbit.calendar")

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
_SCOPES = "openid email https://www.googleapis.com/auth/calendar.events"

_SETUP_HINT = (
    "Google Calendar isn't configured. Create an OAuth client (Web application) in "
    "Google Cloud Console, add the redirect URI "
    f"{settings.google_redirect_uri}, then set GOOGLE_CLIENT_ID and "
    "GOOGLE_CLIENT_SECRET in backend/.env and restart the API."
)


def _configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def _room_url(room_id: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/call/{room_id}"


async def _connection(db) -> CalendarConnection | None:
    return await db.get(CalendarConnection, "google")


def _auto_link_on(conn: CalendarConnection) -> bool:
    return conn.auto_link is not False  # NULL (pre-migration rows) counts as ON


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
        "autoLink": _auto_link_on(conn) if conn else True,
    }


class CalendarSettingsIn(BaseModel):
    autoLink: bool


@router.patch("/settings")
async def patch_settings(body: CalendarSettingsIn, db=Depends(get_db), _=Depends(get_current_user)):
    conn = await _connection(db)
    if not conn:
        raise HTTPException(409, "Google Calendar is not connected")
    conn.auto_link = body.autoLink
    await db.commit()
    return {"connected": True, "email": conn.email, "autoLink": conn.auto_link}


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
        conn = CalendarConnection(id="google", connected_at=now, auto_link=True)
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


# --- Orbit-link machinery -------------------------------------------------------
def _event_time(block: dict) -> str | None:
    return block.get("dateTime") or block.get("date")


def _eligible_for_auto_link(ev: dict) -> bool:
    """Real FUTURE meetings only: timed (not all-day), not already started, and
    with other people or a Meet link. Past events are never touched."""
    start_raw = (ev.get("start") or {}).get("dateTime")
    if not start_raw:
        return False
    if datetime.fromisoformat(start_raw) <= datetime.now(timezone.utc).astimezone():
        return False
    others = [a for a in ev.get("attendees", []) if not a.get("self") and not a.get("resource")]
    return bool(others) or bool(ev.get("hangoutLink"))


def _account_from_event(ev: dict) -> str:
    domains = {a.get("email", "").split("@")[-1] for a in ev.get("attendees", []) if a.get("email") and not a.get("self")}
    return next((d for d in sorted(domains) if d and d != "gmail.com"), "")


async def _room_for_event(ev: dict, db) -> CallRoom:
    """Get or create the CallRoom bound to a Google event."""
    from sqlalchemy import select
    room = (await db.execute(
        select(CallRoom).where(CallRoom.calendar_event_id == ev["id"]))).scalars().first()
    if room:
        return room
    start_raw = _event_time(ev.get("start", {}))
    room = CallRoom(
        id=f"r_{uuid.uuid4().hex[:8]}", title=ev.get("summary", "Orbit call"),
        account=_account_from_event(ev), status="scheduled", calendar_event_id=ev["id"],
        scheduled_start=datetime.fromisoformat(start_raw) if start_raw and "T" in start_raw else None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(room)
    await db.flush()
    return room


async def _write_link_into_event(client: httpx.AsyncClient, token: str, ev: dict, url: str) -> bool:
    """PATCH the invite so Orbit is THE meeting link: Meet conference removed,
    Orbit link in location + description, attendees notified.

    Returns whether the invite was updated. A 403 (attendee without edit rights
    on someone else's event) is not an error — the room still exists, the link
    just can't ride the invite; the UI explains that.
    Mutates `ev` locally on success so callers can render fresh state.
    """
    patch: dict = {}
    params: dict = {"sendUpdates": "all"}
    description = (ev.get("description") or "").rstrip()
    if url not in description:
        patch["description"] = f"{description}\n\n📞 Join with Orbit: {url}".lstrip()
    location = ev.get("location") or ""
    if not location or "meet.google.com" in location:
        patch["location"] = url
    if ev.get("hangoutLink") or ev.get("conferenceData"):
        patch["conferenceData"] = None  # Orbit owns the space
        params["conferenceDataVersion"] = 1
    if not patch:
        return True

    res = await client.patch(f"{_EVENTS_URL}/{ev['id']}", params=params,
                             headers={"Authorization": f"Bearer {token}"}, json=patch)
    if res.status_code == 403:
        return False
    if res.status_code != 200:
        raise HTTPException(502, f"Couldn't update the event: {res.text[:200]}")
    ev["description"] = patch.get("description", ev.get("description"))
    if "location" in patch:
        ev["location"] = patch["location"]
    if "conferenceData" in patch:
        ev["hangoutLink"] = None
        ev["conferenceData"] = None
    return True


def _event_out(ev: dict, room: CallRoom | None) -> dict:
    url = _room_url(room.id) if room else None
    in_invite = bool(url) and (url in (ev.get("description") or "") or url == (ev.get("location") or ""))
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
        "orbitRoomId": room.id if room else None,
        "orbitUrl": url,
        "linkedInInvite": in_invite,
    }


# --- Events --------------------------------------------------------------------
@router.get("/events")
async def list_events(time_min: str | None = None, days: int = 7,
                      db=Depends(get_db), _=Depends(get_current_user)):
    """Events in a window (read-only — events are created in the user's calendar
    apps). `time_min` (ISO, default now) + `days` let the week view page back
    and forth like Google Calendar.

    With auto-link ON, FUTURE meetings not yet linked get their Orbit room here
    as part of the sync, and their invites are patched concurrently — so
    steady-state loads make exactly one Google call and stay fast."""
    conn = await _connection(db)
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

        from sqlalchemy import select
        rooms = (await db.execute(
            select(CallRoom).where(CallRoom.calendar_event_id.is_not(None)))).scalars().all()
        room_by_event = {r.calendar_event_id: r for r in rooms}

        if conn and _auto_link_on(conn):
            new = [ev for ev in items if ev["id"] not in room_by_event and _eligible_for_auto_link(ev)]
            for ev in new:  # rooms are local + cheap; create before touching Google
                room_by_event[ev["id"]] = await _room_for_event(ev, db)
            await db.commit()
            results = await asyncio.gather(
                *[_write_link_into_event(client, token, ev, _room_url(room_by_event[ev["id"]].id))
                  for ev in new],
                return_exceptions=True,
            )
            for ev, r in zip(new, results):
                if isinstance(r, Exception):
                    logger.warning("auto-link failed for event %s: %s", ev["id"], r)

    return [_event_out(ev, room_by_event.get(ev["id"])) for ev in items]


@router.post("/events/{event_id}/orbit-link")
async def add_orbit_link(event_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Manually link one event (auto-link off, or an event outside the auto rules).
    Same behavior as the sync: Orbit replaces Meet as the meeting link."""
    token = await _access_token(db)
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(f"{_EVENTS_URL}/{event_id}", headers={"Authorization": f"Bearer {token}"})
        if res.status_code != 200:
            raise HTTPException(404, "Calendar event not found")
        ev = res.json()
        room = await _room_for_event(ev, db)
        linked = await _write_link_into_event(client, token, ev, _room_url(room.id))
    await db.commit()
    return {"roomId": room.id, "url": _room_url(room.id), "linkedInInvite": linked}
