"""Orbit Calls — Orbit hosts the meeting itself (the Lyra model).

The browser call page does WebRTC peer-to-peer media; this router is the
signaling plane (one WebSocket per participant) plus the live transcript sink.
Each participant's OWN browser transcribes their OWN microphone (per-mic
accuracy, no diarization guessing) and streams named, timestamped segments
here. When the call ends we finalize the room into a Meeting — real speakers,
real timestamps — and the standard analysis pipeline takes it from there.

The room registry is in-memory (single-process dev server). Media never
touches this server; only signaling + transcript text do.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified

from ..config import settings
from ..database import SessionLocal
from ..deps import Depends, get_current_user, get_db
from ..models import CallRoom, Meeting, TimelineEvent
from ..redis_client import publish_event
from .meetings import _analyze_in_background

router = APIRouter(tags=["calls"])
logger = logging.getLogger("orbit.calls")


# --- In-memory hub -------------------------------------------------------------
class _Hub:
    """Connected peers per room: {room_id: {peer_id: {"ws": WebSocket, "name": str}}}."""

    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, dict]] = {}
        self.lock = asyncio.Lock()

    async def join(self, room_id: str, peer_id: str, name: str, ws: WebSocket) -> list[dict]:
        async with self.lock:
            peers = self.rooms.setdefault(room_id, {})
            roster = [{"peerId": pid, "name": p["name"]} for pid, p in peers.items()]
            peers[peer_id] = {"ws": ws, "name": name}
        return roster

    async def leave(self, room_id: str, peer_id: str) -> None:
        async with self.lock:
            self.rooms.get(room_id, {}).pop(peer_id, None)
            if not self.rooms.get(room_id):
                self.rooms.pop(room_id, None)

    async def send(self, room_id: str, peer_id: str, message: dict) -> None:
        peer = self.rooms.get(room_id, {}).get(peer_id)
        if peer:
            try:
                await peer["ws"].send_json(message)
            except Exception:  # peer mid-disconnect; the reader loop cleans up
                pass

    async def broadcast(self, room_id: str, message: dict, exclude: str | None = None) -> None:
        for pid in list(self.rooms.get(room_id, {})):
            if pid != exclude:
                await self.send(room_id, pid, message)


hub = _Hub()


def _room_url(room_id: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/call/{room_id}"


def _as_utc(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


# --- REST ------------------------------------------------------------------------
class CreateCallIn(BaseModel):
    title: str = "Instant Orbit call"
    account: str = ""


@router.post("/calls", status_code=201)
async def create_call(body: CreateCallIn, db=Depends(get_db), _=Depends(get_current_user)):
    """Start an ad-hoc call room (no calendar event needed)."""
    room = CallRoom(
        id=f"r_{uuid.uuid4().hex[:8]}", title=body.title.strip() or "Instant Orbit call",
        account=body.account, status="scheduled", created_at=datetime.now(timezone.utc),
    )
    db.add(room)
    await db.commit()
    return {"roomId": room.id, "url": _room_url(room.id)}


@router.get("/calls/{room_id}")
async def get_call(room_id: str, db=Depends(get_db)):
    """Room info for the pre-join screen. Public on purpose: guests join by link."""
    room = await db.get(CallRoom, room_id)
    if not room:
        raise HTTPException(404, "Call not found")
    return {
        "roomId": room.id, "title": room.title, "account": room.account, "status": room.status,
        "scheduledStart": room.scheduled_start, "startedAt": room.started_at,
        "meetingId": room.meeting_id, "liveParticipants": len(hub.rooms.get(room_id, {})),
    }


@router.post("/calls/{room_id}/end")
async def end_call(room_id: str, background: BackgroundTasks, db=Depends(get_db)):
    """Finalize the call: room → Meeting (real speakers + timestamps) → pipeline."""
    room = await db.get(CallRoom, room_id)
    if not room:
        raise HTTPException(404, "Call not found")
    if room.status == "ended":
        return {"meetingId": room.meeting_id, "status": "ended"}

    now = datetime.now(timezone.utc)
    started = _as_utc(room.started_at) or now
    room.status = "ended"
    room.ended_at = now
    segments = sorted(room.transcript or [], key=lambda s: s.get("start", 0))
    has_speech = any((s.get("text") or "").strip() for s in segments)

    meeting = Meeting(
        id=f"m_{uuid.uuid4().hex[:8]}",
        title=room.title,
        source="orbit-call",
        status="analyzing" if has_speech else "analyzed",
        account=room.account or "Orbit call",
        date=started,
        duration_sec=max(0, int((now - started).total_seconds())),
        analysis_progress=5 if has_speech else 100,
        participants=[
            {"id": p.get("id", f"s_{i}"), "name": p.get("name", "Guest"), "role": "Participant",
             "company": room.account or "", "type": "customer", "sentiment": "neutral"}
            for i, p in enumerate(room.participants or [])
        ],
        transcript=segments,
        tags=["orbit-call"],
    )
    db.add(meeting)
    room.meeting_id = meeting.id
    db.add(TimelineEvent(
        id=f"ev_{uuid.uuid4().hex[:8]}", kind="meeting-uploaded", title=f"{room.title} — call ended",
        description=f"Live Orbit call · {len(room.participants or [])} participants · "
                    f"{len(segments)} transcript segments.",
        at=now, actor="Orbit Calls", meeting_id=meeting.id,
    ))
    await db.commit()
    await publish_event("orbit:pipeline", {"type": "call.ended", "roomId": room.id, "meetingId": meeting.id})

    await hub.broadcast(room_id, {"type": "ended", "meetingId": meeting.id})
    if has_speech:
        background.add_task(_analyze_in_background, meeting.id)
    return {"meetingId": meeting.id, "status": "ended"}


# --- WebSocket: signaling + roster + live transcript ------------------------------
async def _mark_live(room_id: str) -> datetime:
    """Flip the room live on first join; return its started_at."""
    async with SessionLocal() as db:
        room = await db.get(CallRoom, room_id)
        if room.status != "live" or not room.started_at:
            room.status = "live"
            room.started_at = room.started_at or datetime.now(timezone.utc)
            await db.commit()
        return _as_utc(room.started_at)


async def _record_participant(room_id: str, peer_id: str, name: str, *, left: bool = False) -> None:
    async with SessionLocal() as db:
        room = await db.get(CallRoom, room_id)
        if not room:
            return
        people = room.participants or []
        now = datetime.now(timezone.utc).isoformat()
        mine = next((p for p in people if p.get("id") == peer_id), None)
        if left:
            if mine:
                mine["leftAt"] = now
        elif not mine:
            people.append({"id": peer_id, "name": name, "joinedAt": now})
        room.participants = people
        flag_modified(room, "participants")
        await db.commit()


async def _append_segment(room_id: str, speaker: str, text: str, start: float, end: float) -> dict:
    async with SessionLocal() as db:
        room = await db.get(CallRoom, room_id)
        segments = room.transcript or []
        seg = {"id": f"t{len(segments) + 1}", "speaker": speaker,
               "start": round(max(0.0, start), 1), "end": round(max(0.0, end), 1), "text": text}
        segments.append(seg)
        room.transcript = segments
        flag_modified(room, "transcript")
        await db.commit()
        return seg


@router.websocket("/ws/calls/{room_id}")
async def call_socket(ws: WebSocket, room_id: str):
    await ws.accept()
    async with SessionLocal() as db:
        room = await db.get(CallRoom, room_id)
    if not room or room.status == "ended":
        await ws.send_json({"type": "error", "message": "This call doesn't exist or already ended."})
        await ws.close()
        return

    peer_id: str | None = None
    name = "Guest"
    try:
        first = await ws.receive_json()
        if first.get("type") != "join":
            await ws.close()
            return
        name = str(first.get("name") or "Guest").strip()[:60] or "Guest"
        peer_id = f"pe_{uuid.uuid4().hex[:8]}"

        started_at = await _mark_live(room_id)
        roster = await hub.join(room_id, peer_id, name, ws)
        await _record_participant(room_id, peer_id, name)
        await ws.send_json({"type": "welcome", "peerId": peer_id, "roster": roster,
                            "startedAt": started_at.isoformat()})
        await hub.broadcast(room_id, {"type": "peer-joined", "peerId": peer_id, "name": name}, exclude=peer_id)

        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "signal":  # WebRTC SDP / ICE relay
                await hub.send(room_id, msg.get("to", ""), {
                    "type": "signal", "from": peer_id, "name": name, "data": msg.get("data"),
                })
            elif kind == "transcript":
                text = str(msg.get("text") or "").strip()
                if not text:
                    continue
                # Server-stamped timing keeps every client's segments on one clock.
                # end is always ≥ 0.5s so start < end even in the first instant.
                end = max(0.5, (datetime.now(timezone.utc) - started_at).total_seconds())
                start = end - min(120.0, max(0.5, float(msg.get("dur") or 2.0)))
                seg = await _append_segment(room_id, name, text, start, end)
                await hub.broadcast(room_id, {"type": "transcript", **seg})
            elif kind == "leave":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("call socket error in room %s", room_id)
    finally:
        if peer_id:
            await hub.leave(room_id, peer_id)
            await _record_participant(room_id, peer_id, name, left=True)
            await hub.broadcast(room_id, {"type": "peer-left", "peerId": peer_id, "name": name})
