"""Google Meet integration — real OAuth, no mocks.

Meet stays the meeting platform; Orbit ingests what happened there via the
Meet REST API: conference records are listed, and importing one pulls its
per-speaker transcript ENTRIES (structured — no Docs parsing), builds a
Meeting(source="google-meet") and runs the standard analysis pipeline.

Reuses the same Google OAuth client as Calendar (GOOGLE_CLIENT_ID/SECRET) with
its own consent + token row (`calendar_connections` id="google-meet") because
the scopes differ. Requirements on the Google side: the *Google Meet REST API*
enabled in the Cloud project, MEET_REDIRECT_URI added to the OAuth client, and
a Workspace plan with Meet transcription (transcripts only exist if they were
turned on during the call).
"""
from __future__ import annotations

import asyncio
import logging
import uuid as uuid_mod
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from ..config import settings
from ..deps import Depends, get_current_user, get_db
from ..models import CalendarConnection, Integration, Meeting, TimelineEvent
from ..services.customers import resolve_customer
from ..services.workspace import get_workspace_id
from .meetings import _analyze_in_background

router = APIRouter(prefix="/meet", tags=["meet"])
logger = logging.getLogger("orbit.meet")

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_API = "https://meet.googleapis.com/v2"
_SCOPES = "openid email https://www.googleapis.com/auth/meetings.space.readonly"

_SETUP_HINT = (
    "Google Meet isn't configured. It reuses the Calendar OAuth client — set "
    "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env, enable the "
    "'Google Meet REST API' in the Google Cloud project, and add the redirect URI "
    f"{settings.meet_redirect_uri} to the OAuth client."
)


def _configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


async def _connection(db) -> CalendarConnection | None:
    return await db.get(CalendarConnection, "google-meet")


async def _access_token(db) -> str:
    conn = await _connection(db)
    if not conn:
        raise HTTPException(409, "Google Meet is not connected")
    now = datetime.now(timezone.utc)
    expiry = conn.token_expiry
    if expiry is not None and expiry.tzinfo is None:  # SQLite drops tzinfo
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry and expiry > now + timedelta(seconds=60):
        return conn.access_token
    if not conn.refresh_token:
        raise HTTPException(409, "Google session expired — reconnect Google Meet")
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
    integ = await db.get(Integration, "google-meet")
    if integ:
        integ.status = "connected" if connected else "disconnected"
        integ.account = email or None
        integ.last_sync = datetime.now(timezone.utc) if connected else None


# --- Connection lifecycle -----------------------------------------------------
@router.get("/status")
async def meet_status(db=Depends(get_db), _=Depends(get_current_user)):
    conn = await _connection(db)
    return {"configured": _configured(), "connected": bool(conn), "email": conn.email if conn else None}


@router.get("/connect")
async def meet_connect(_=Depends(get_current_user)):
    if not _configured():
        raise HTTPException(503, _SETUP_HINT)
    params = httpx.QueryParams({
        "client_id": settings.google_client_id,
        "redirect_uri": settings.meet_redirect_uri,
        "response_type": "code",
        "scope": _SCOPES,
        "access_type": "offline",
        "prompt": "consent",  # always re-issue the refresh token
    })
    return {"url": f"{_AUTH_URL}?{params}"}


@router.get("/oauth/callback")
async def meet_oauth_callback(code: str | None = None, error: str | None = None, db=Depends(get_db)):
    front = f"{settings.frontend_url.rstrip('/')}/integrations"
    if error or not code:
        return RedirectResponse(f"{front}?meet=error&reason={error or 'no_code'}")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.meet_redirect_uri,
            "grant_type": "authorization_code",
        })
        if res.status_code != 200:
            return RedirectResponse(f"{front}?meet=error&reason=token_exchange")
        tok = res.json()
        info = await client.get(_USERINFO_URL, headers={"Authorization": f"Bearer {tok['access_token']}"})
        email = info.json().get("email", "") if info.status_code == 200 else ""

    now = datetime.now(timezone.utc)
    conn = await _connection(db)
    if not conn:
        conn = CalendarConnection(id="google-meet", connected_at=now)
        db.add(conn)
    conn.email = email
    conn.access_token = tok["access_token"]
    conn.refresh_token = tok.get("refresh_token") or conn.refresh_token
    conn.token_expiry = now + timedelta(seconds=int(tok.get("expires_in", 3600)))
    conn.scopes = tok.get("scope", _SCOPES)
    await _set_integration_row(db, connected=True, email=email)
    await db.commit()
    return RedirectResponse(f"{front}?meet=connected")


@router.post("/disconnect")
async def meet_disconnect(db=Depends(get_db), _=Depends(get_current_user)):
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


# --- Conference records ---------------------------------------------------------
def _record_id(name: str) -> str:
    return name.split("/")[-1]  # "conferenceRecords/{id}"


def _meet_tag(record_id: str) -> str:
    return f"meet:{record_id}"


async def _imported_map(db) -> dict[str, str]:
    """conference record id -> meeting id, for idempotent re-imports."""
    rows = (await db.execute(select(Meeting).where(Meeting.source == "google-meet"))).scalars().all()
    out: dict[str, str] = {}
    for m in rows:
        for t in m.tags or []:
            if t.startswith("meet:"):
                out[t.removeprefix("meet:")] = m.id
    return out


async def _list_transcripts(client: httpx.AsyncClient, token: str, record_name: str) -> list[dict]:
    res = await client.get(f"{_API}/{record_name}/transcripts",
                           headers={"Authorization": f"Bearer {token}"})
    if res.status_code != 200:
        return []
    return res.json().get("transcripts", [])


@router.get("/recordings")
async def list_recordings(db=Depends(get_db), _=Depends(get_current_user)):
    """Recent conference records, shaped like the Zoom recording summaries so the
    frontend import dialog is shared. `hasTranscript` is checked concurrently."""
    token = await _access_token(db)
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(f"{_API}/conferenceRecords", params={"pageSize": 15},
                               headers={"Authorization": f"Bearer {token}"})
        if res.status_code == 403:
            raise HTTPException(502, "Google refused the request — is the 'Google Meet REST API' "
                                     "enabled in your Cloud project? " + res.text[:150])
        if res.status_code != 200:
            raise HTTPException(502, f"Google Meet error: {res.text[:200]}")
        records = res.json().get("conferenceRecords", [])
        transcript_lists = await asyncio.gather(
            *[_list_transcripts(client, token, r["name"]) for r in records])

    imported = await _imported_map(db)
    out = []
    for rec, transcripts in zip(records, transcript_lists):
        rid = _record_id(rec["name"])
        start = rec.get("startTime")
        end = rec.get("endTime")
        duration_min = 0
        if start and end:
            duration_min = max(1, round((datetime.fromisoformat(end.replace("Z", "+00:00"))
                                         - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() / 60))
        when = start[:16].replace("T", " ") if start else "unknown time"
        out.append({
            "uuid": rid,
            "topic": f"Google Meet · {when}",
            "startTime": start,
            "durationMin": duration_min,
            "hasTranscript": bool(transcripts),
            "meetingId": imported.get(rid),
        })
    out.sort(key=lambda r: r.get("startTime") or "", reverse=True)
    return out


class ImportMeetIn(BaseModel):
    uuid: str  # conference record id
    account: str | None = None  # optional customer label from the import dialog


async def _participant_names(client: httpx.AsyncClient, token: str, record_name: str) -> dict[str, str]:
    """participant resource name -> display name (signed-in, anonymous or phone)."""
    names: dict[str, str] = {}
    page = None
    while True:
        res = await client.get(f"{_API}/{record_name}/participants",
                               params={"pageSize": 100, **({"pageToken": page} if page else {})},
                               headers={"Authorization": f"Bearer {token}"})
        if res.status_code != 200:
            return names
        body = res.json()
        for p in body.get("participants", []):
            who = p.get("signedinUser") or p.get("anonymousUser") or p.get("phoneUser") or {}
            names[p["name"]] = who.get("displayName") or "Guest"
        page = body.get("nextPageToken")
        if not page:
            return names


@router.post("/recordings/import")
async def import_recording(body: ImportMeetIn, background: BackgroundTasks,
                           db=Depends(get_db), ws: str = Depends(get_workspace_id)):
    """Pull one conference record's transcript entries into a Meeting and analyze it."""
    imported = await _imported_map(db)
    if body.uuid in imported:
        return {"meetingId": imported[body.uuid], "status": "already-imported"}

    record_name = f"conferenceRecords/{body.uuid}"
    token = await _access_token(db)
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(f"{_API}/{record_name}", headers={"Authorization": f"Bearer {token}"})
        if res.status_code != 200:
            raise HTTPException(404, "Conference record not found")
        rec = res.json()

        transcripts = await _list_transcripts(client, token, record_name)
        if not transcripts:
            raise HTTPException(409, "This meeting has no transcript — turn on transcription in "
                                     "Meet during the call (Workspace feature).")
        transcript_name = transcripts[0]["name"]

        entries, page = [], None
        while True:
            res = await client.get(f"{_API}/{transcript_name}/entries",
                                   params={"pageSize": 500, **({"pageToken": page} if page else {})},
                                   headers={"Authorization": f"Bearer {token}"})
            if res.status_code != 200:
                raise HTTPException(502, f"Couldn't fetch transcript entries: {res.text[:200]}")
            data = res.json()
            entries.extend(data.get("transcriptEntries", []))
            page = data.get("nextPageToken")
            if not page:
                break
        if not entries:
            raise HTTPException(409, "The transcript is empty")

        names = await _participant_names(client, token, record_name)

    def _ts(value: str | None) -> datetime | None:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None

    started = _ts(rec.get("startTime")) or datetime.now(timezone.utc)
    ended = _ts(rec.get("endTime"))
    segments = []
    for i, e in enumerate(entries):
        s, t = _ts(e.get("startTime")), _ts(e.get("endTime"))
        segments.append({
            "id": f"t{i + 1}",
            "speaker": names.get(e.get("participant", ""), "Guest"),
            "start": max(0, (s - started).total_seconds()) if s else 0,
            "end": max(0, (t - started).total_seconds()) if t else 0,
            "text": e.get("text", ""),
        })
    speakers = list(dict.fromkeys(s["speaker"] for s in segments))

    customer = await resolve_customer(db, ws, body.account or "")
    when = rec.get("startTime", "")[:16].replace("T", " ")
    meeting = Meeting(
        id=f"m_{uuid_mod.uuid4().hex[:8]}",
        title=(f"{customer.name} — Google Meet" if customer else f"Google Meet · {when}"),
        source="google-meet",
        status="analyzing",
        account=customer.name if customer else (body.account or "Google Meet import"),
        customer_id=customer.id if customer else None,
        workspace_id=ws,
        date=started,
        duration_sec=int((ended - started).total_seconds()) if ended else 0,
        analysis_progress=5,
        participants=[
            {"id": f"s_{i}", "name": n, "role": "Participant", "company": "",
             "type": "customer", "sentiment": "neutral"}
            for i, n in enumerate(speakers)
        ],
        transcript=segments,
        tags=["meet-import", _meet_tag(body.uuid)],
    )
    db.add(meeting)
    db.add(TimelineEvent(
        id=f"ev_{uuid_mod.uuid4().hex[:8]}", kind="meeting-uploaded",
        title=f"{meeting.title} imported from Google Meet",
        description=f"{len(segments)} transcript segments · {len(speakers)} speakers.",
        at=datetime.now(timezone.utc), actor="Google Meet", meeting_id=meeting.id,
    ))
    await db.commit()
    background.add_task(_analyze_in_background, meeting.id)
    return {"meetingId": meeting.id, "status": "analyzing"}
