"""Zoom integration — real OAuth, no mocks.

Zoom's API can't host links inside a Zoom meeting, so owning-the-call for
Zoom-scheduled meetings happens on the calendar side (the invite's zoom.us link
is replaced by the Orbit link during calendar sync). What Zoom OAuth adds is the
conversations that still happen on Zoom: cloud recordings are listed here and
imported — their per-speaker VTT transcript becomes a Meeting and runs the
standard analysis pipeline.

Requires ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET in backend/.env; endpoints fail
loudly (503) with setup instructions when unset. Zoom rotates refresh tokens on
every refresh — the new one must always be persisted.
"""
from __future__ import annotations

import logging
import re
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
from .meetings import _analyze_in_background

router = APIRouter(prefix="/zoom", tags=["zoom"])
logger = logging.getLogger("orbit.zoom")

_AUTH_URL = "https://zoom.us/oauth/authorize"
_TOKEN_URL = "https://zoom.us/oauth/token"
_REVOKE_URL = "https://zoom.us/oauth/revoke"
_API = "https://api.zoom.us/v2"

_SETUP_HINT = (
    "Zoom isn't configured. Create a General App (OAuth) at marketplace.zoom.us, "
    f"set the redirect URL to {settings.zoom_redirect_uri}, add the user:read and "
    "cloud_recording:read scopes, then set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET "
    "in backend/.env and restart the API."
)


def _configured() -> bool:
    return bool(settings.zoom_client_id and settings.zoom_client_secret)


def _basic_auth() -> tuple[str, str]:
    return (settings.zoom_client_id or "", settings.zoom_client_secret or "")


async def _connection(db) -> CalendarConnection | None:
    # The connections table is provider-keyed; Zoom reuses it under id="zoom".
    return await db.get(CalendarConnection, "zoom")


async def _access_token(db) -> str:
    conn = await _connection(db)
    if not conn:
        raise HTTPException(409, "Zoom is not connected")
    now = datetime.now(timezone.utc)
    expiry = conn.token_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry and expiry > now + timedelta(seconds=60):
        return conn.access_token
    if not conn.refresh_token:
        raise HTTPException(409, "Zoom session expired — reconnect Zoom")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(_TOKEN_URL, auth=_basic_auth(), data={
            "grant_type": "refresh_token", "refresh_token": conn.refresh_token,
        })
    if res.status_code != 200:
        raise HTTPException(502, f"Zoom token refresh failed: {res.text[:200]}")
    tok = res.json()
    conn.access_token = tok["access_token"]
    conn.refresh_token = tok.get("refresh_token") or conn.refresh_token  # Zoom rotates it
    conn.token_expiry = now + timedelta(seconds=int(tok.get("expires_in", 3600)))
    await db.commit()
    return conn.access_token


async def _set_integration_row(db, *, connected: bool, email: str = "") -> None:
    integ = await db.get(Integration, "zoom")
    if integ:
        integ.status = "connected" if connected else "disconnected"
        integ.account = email or None
        integ.last_sync = datetime.now(timezone.utc) if connected else None


# --- Connection lifecycle -----------------------------------------------------
@router.get("/status")
async def zoom_status(db=Depends(get_db), _=Depends(get_current_user)):
    conn = await _connection(db)
    return {"configured": _configured(), "connected": bool(conn), "email": conn.email if conn else None}


@router.get("/connect")
async def zoom_connect(_=Depends(get_current_user)):
    if not _configured():
        raise HTTPException(503, _SETUP_HINT)
    params = httpx.QueryParams({
        "response_type": "code",
        "client_id": settings.zoom_client_id,
        "redirect_uri": settings.zoom_redirect_uri,
    })
    return {"url": f"{_AUTH_URL}?{params}"}


@router.get("/oauth/callback")
async def zoom_oauth_callback(code: str | None = None, error: str | None = None, db=Depends(get_db)):
    front = f"{settings.frontend_url.rstrip('/')}/integrations"
    if error or not code:
        return RedirectResponse(f"{front}?zoom=error&reason={error or 'no_code'}")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(_TOKEN_URL, auth=_basic_auth(), data={
            "grant_type": "authorization_code", "code": code,
            "redirect_uri": settings.zoom_redirect_uri,
        })
        if res.status_code != 200:
            return RedirectResponse(f"{front}?zoom=error&reason=token_exchange")
        tok = res.json()
        me = await client.get(f"{_API}/users/me", headers={"Authorization": f"Bearer {tok['access_token']}"})
        email = me.json().get("email", "") if me.status_code == 200 else ""

    now = datetime.now(timezone.utc)
    conn = await _connection(db)
    if not conn:
        conn = CalendarConnection(id="zoom", connected_at=now)
        db.add(conn)
    conn.email = email
    conn.access_token = tok["access_token"]
    conn.refresh_token = tok.get("refresh_token")
    conn.token_expiry = now + timedelta(seconds=int(tok.get("expires_in", 3600)))
    conn.scopes = tok.get("scope", "")
    await _set_integration_row(db, connected=True, email=email)
    await db.commit()
    return RedirectResponse(f"{front}?zoom=connected")


@router.post("/disconnect")
async def zoom_disconnect(db=Depends(get_db), _=Depends(get_current_user)):
    conn = await _connection(db)
    if conn:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(_REVOKE_URL, auth=_basic_auth(), params={"token": conn.access_token})
        except httpx.HTTPError:
            pass
        await db.delete(conn)
    await _set_integration_row(db, connected=False)
    await db.commit()
    return {"connected": False}


# --- Cloud recordings -----------------------------------------------------------
def _zoom_tag(rec_uuid: str) -> str:
    return f"zoom:{rec_uuid}"


async def _imported_map(db) -> dict[str, str]:
    """{recording uuid -> meeting id} for recordings already pulled in."""
    rows = (await db.execute(select(Meeting).where(Meeting.source == "zoom"))).scalars().all()
    out: dict[str, str] = {}
    for m in rows:
        for t in m.tags or []:
            if t.startswith("zoom:"):
                out[t[5:]] = m.id
    return out


async def _fetch_recordings(db) -> list[dict]:
    token = await _access_token(db)
    now = datetime.now(timezone.utc)
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{_API}/users/me/recordings", params={
            "from": (now - timedelta(days=30)).date().isoformat(),  # Zoom caps the range at 30 days
            "to": now.date().isoformat(),
            "page_size": 30,
        }, headers={"Authorization": f"Bearer {token}"})
    if res.status_code != 200:
        raise HTTPException(502, f"Zoom error: {res.text[:200]}")
    return res.json().get("meetings", [])


@router.get("/recordings")
async def list_recordings(db=Depends(get_db), _=Depends(get_current_user)):
    """Cloud recordings from the last 30 days, with import state."""
    meetings = await _fetch_recordings(db)
    imported = await _imported_map(db)
    out = []
    for rec in meetings:
        files = rec.get("recording_files", [])
        out.append({
            "uuid": rec.get("uuid", ""),
            "topic": rec.get("topic", "(no topic)"),
            "startTime": rec.get("start_time"),
            "durationMin": rec.get("duration", 0),
            "hasTranscript": any(f.get("file_type") == "TRANSCRIPT" for f in files),
            "meetingId": imported.get(rec.get("uuid", "")),
        })
    return out


_TS = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})")


def _vtt_seconds(ts: str) -> float:
    m = _TS.search(ts)
    if not m:
        return 0.0
    h, mi, s, ms = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s + ms / 1000


def parse_vtt(vtt: str) -> list[dict]:
    """Zoom transcript VTT → per-speaker segments ({speaker,start,end,text})."""
    segments: list[dict] = []
    for block in re.split(r"\n\s*\n", vtt.replace("\r\n", "\n")):
        lines = [ln.strip() for ln in block.strip().splitlines() if ln.strip()]
        time_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if time_idx is None:
            continue
        start_raw, _, end_raw = lines[time_idx].partition("-->")
        text = " ".join(lines[time_idx + 1:]).strip()
        if not text:
            continue
        speaker, sep, rest = text.partition(": ")
        if sep and 0 < len(speaker) <= 60:
            text = rest
        else:
            speaker = "Speaker"
        segments.append({
            "id": f"t{len(segments) + 1}", "speaker": speaker,
            "start": round(_vtt_seconds(start_raw), 1), "end": round(_vtt_seconds(end_raw), 1),
            "text": text,
        })
    return segments


class ImportRecordingIn(BaseModel):
    uuid: str


@router.post("/recordings/import")
async def import_recording(body: ImportRecordingIn, background: BackgroundTasks,
                           db=Depends(get_db), _=Depends(get_current_user)):
    """Pull one recording's transcript into a Meeting and analyze it."""
    imported = await _imported_map(db)
    if body.uuid in imported:
        return {"meetingId": imported[body.uuid], "status": "already-imported"}

    rec = next((r for r in await _fetch_recordings(db) if r.get("uuid") == body.uuid), None)
    if not rec:
        raise HTTPException(404, "Recording not found in the last 30 days")
    transcript_file = next(
        (f for f in rec.get("recording_files", []) if f.get("file_type") == "TRANSCRIPT"), None)
    if not transcript_file:
        raise HTTPException(409, "This recording has no transcript — enable 'Audio transcript' "
                                 "under Zoom Settings → Recording → Cloud recording.")

    token = await _access_token(db)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        res = await client.get(transcript_file["download_url"],
                               headers={"Authorization": f"Bearer {token}"})
    if res.status_code != 200:
        raise HTTPException(502, f"Couldn't download the transcript: {res.status_code}")
    segments = parse_vtt(res.text)
    if not segments:
        raise HTTPException(409, "The transcript file was empty")

    started = datetime.fromisoformat(rec["start_time"]) if rec.get("start_time") else datetime.now(timezone.utc)
    speakers = list(dict.fromkeys(s["speaker"] for s in segments))
    meeting = Meeting(
        id=f"m_{uuid_mod.uuid4().hex[:8]}",
        title=rec.get("topic", "Zoom meeting"),
        source="zoom",
        status="analyzing",
        account=rec.get("topic", "Zoom import"),
        date=started,
        duration_sec=int(rec.get("duration", 0)) * 60,
        analysis_progress=5,
        participants=[
            {"id": f"s_{i}", "name": n, "role": "Participant", "company": "",
             "type": "customer", "sentiment": "neutral"}
            for i, n in enumerate(speakers)
        ],
        transcript=segments,
        tags=["zoom-import", _zoom_tag(body.uuid)],
    )
    db.add(meeting)
    db.add(TimelineEvent(
        id=f"ev_{uuid_mod.uuid4().hex[:8]}", kind="meeting-uploaded",
        title=f"{meeting.title} imported from Zoom",
        description=f"{len(segments)} transcript segments · {len(speakers)} speakers.",
        at=datetime.now(timezone.utc), actor="Zoom", meeting_id=meeting.id,
    ))
    await db.commit()
    background.add_task(_analyze_in_background, meeting.id)
    return {"meetingId": meeting.id, "status": "analyzing"}
