from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from sqlalchemy import delete

from ..agents.orchestrator import run_pipeline, signals_to_analysis
from ..agents.persistence import delete_execution, persist_execution
from ..database import SessionLocal
from ..deps import Depends, get_current_user, get_db
from ..models import ActivityEvent, Meeting, Project, TimelineEvent
from ..redis_client import publish_event
from ..schemas import MeetingOut, RunTranscriptIn, UploadMeetingIn

router = APIRouter(prefix="/meetings", tags=["meetings"])
logger = logging.getLogger("orbit.meetings")


async def _analyze_in_background(meeting_id: str) -> None:
    """Run the full agent pipeline for a meeting, writing real progress after each stage.

    Runs detached from the request in its own DB session so the endpoint can return
    immediately and the UI can poll the meeting to watch progress climb. On failure the
    meeting is marked `failed` rather than left spinning.
    """
    async with SessionLocal() as db:
        m = await db.get(Meeting, meeting_id)
        if not m:
            return
        transcript_text = "\n".join(f"{s.get('speaker', '?')}: {s.get('text', '')}" for s in (m.transcript or []))
        if not transcript_text.strip():
            m.status = "failed"
            await db.commit()
            return

        async def on_progress(pct: int, _label: str) -> None:
            m.status = "analyzing"
            m.analysis_progress = max(m.analysis_progress or 0, pct)  # never go backwards
            await db.commit()

        try:
            state = await run_pipeline(m.id, transcript_text, m.account, on_progress=on_progress)
            analysis = signals_to_analysis(state.get("signals", {}))
            m.analysis = analysis
            if analysis.get("featureRequests") or analysis.get("painPoints"):
                m.linked_project_id = await persist_execution(m, state, db)
            else:
                await delete_execution(m.id, db)
                m.linked_project_id = None
            m.status = "analyzed"
            m.analysis_progress = 100
            db.add(TimelineEvent(
                id=f"ev_{uuid.uuid4().hex[:8]}", kind="ai-analysis", title="AI analysis complete",
                description=analysis.get("summary", "")[:160], at=datetime.now(timezone.utc),
                actor="Meeting Intelligence", agent="meeting-intelligence", meeting_id=m.id,
            ))
            db.add(ActivityEvent(
                id=f"ac_{uuid.uuid4().hex[:8]}", actor={"name": "Meeting Intelligence", "isAgent": True},
                action="analyzed", target=m.title, target_type="meeting", at=datetime.now(timezone.utc),
                meeting_id=m.id,
            ))
            await db.commit()
            await publish_event("orbit:pipeline", {"type": "meeting.analyzed", "meetingId": m.id})
        except Exception:
            logger.exception("analysis failed for meeting %s", meeting_id)
            m.status = "failed"
            await db.commit()


@router.get("", response_model=list[MeetingOut])
async def list_meetings(db=Depends(get_db), _=Depends(get_current_user)):
    rows = (await db.execute(select(Meeting).order_by(Meeting.date.desc()))).scalars().all()
    return rows


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(meeting_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    return m


@router.post("", response_model=MeetingOut, status_code=201)
async def upload_meeting(body: UploadMeetingIn, background: BackgroundTasks, db=Depends(get_db), _=Depends(get_current_user)):
    has_transcript = bool(body.transcript_text)
    m = Meeting(
        id=f"m_{uuid.uuid4().hex[:8]}",
        title=body.title,
        source=body.source,
        status="analyzing" if has_transcript else "transcribing",
        account=body.account,
        date=datetime.now(timezone.utc),
        duration_sec=0,
        analysis_progress=5,
        participants=[],
        transcript=[{"id": "t1", "speaker": "Speaker 1", "start": 0, "end": 0, "text": body.transcript_text}]
        if has_transcript
        else [],
        tags=["new"],
    )
    db.add(m)
    db.add(TimelineEvent(
        id=f"ev_{uuid.uuid4().hex[:8]}", kind="meeting-uploaded", title=f"{body.title} uploaded",
        description=f"{body.source} source ingested.", at=datetime.now(timezone.utc), actor="Upload", meeting_id=m.id,
    ))
    await db.commit()
    await db.refresh(m)
    await publish_event("orbit:pipeline", {"type": "meeting.uploaded", "meetingId": m.id})
    if has_transcript:
        background.add_task(_analyze_in_background, m.id)  # analyze right away when we already have text
    return m


@router.post("/transcript")
async def run_transcript(body: RunTranscriptIn, background: BackgroundTasks, db=Depends(get_db), _=Depends(get_current_user)):
    """Create a meeting from a pasted transcript and kick off analysis in the background.

    Returns immediately with the new meeting id; the client polls the meeting to watch
    progress climb through the real pipeline stages.
    """
    if not body.transcript.strip():
        raise HTTPException(422, "transcript is required")
    if len(body.transcript.split()) < 6:
        raise HTTPException(422, "Transcript is too short to analyze — paste a real meeting transcript.")

    m = Meeting(
        id=f"m_{uuid.uuid4().hex[:8]}",
        title=body.title,
        source="transcript",
        status="analyzing",
        account=body.account,
        date=datetime.now(timezone.utc),
        duration_sec=0,
        analysis_progress=5,
        participants=[],
        transcript=[{"id": "t1", "speaker": "Transcript", "start": 0, "end": 0, "text": body.transcript}],
        tags=["manual"],
    )
    db.add(m)
    db.add(TimelineEvent(
        id=f"ev_{uuid.uuid4().hex[:8]}", kind="meeting-uploaded", title=f"{body.title} uploaded",
        description="Pasted transcript ingested.", at=datetime.now(timezone.utc), actor="Upload", meeting_id=m.id,
    ))
    await db.commit()
    await publish_event("orbit:pipeline", {"type": "meeting.uploaded", "meetingId": m.id})

    background.add_task(_analyze_in_background, m.id)
    return {"meetingId": m.id, "status": "analyzing"}


@router.post("/{meeting_id}/analyze")
async def analyze_meeting(meeting_id: str, background: BackgroundTasks, db=Depends(get_db), _=Depends(get_current_user)):
    """Re-run the agent pipeline over a stored meeting's transcript (in the background)."""
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    if not any((s.get("text") or "").strip() for s in (m.transcript or [])):
        raise HTTPException(409, "Meeting has no transcript to analyze")
    m.status = "analyzing"
    m.analysis_progress = 5
    await db.commit()
    background.add_task(_analyze_in_background, meeting_id)
    return {"meetingId": m.id, "status": "analyzing"}


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(meeting_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Delete a meeting and everything derived from it (graph, project, tasks,
    timeline, activity)."""
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    await delete_execution(meeting_id, db)
    await db.execute(delete(TimelineEvent).where(TimelineEvent.meeting_id == meeting_id))
    await db.execute(delete(ActivityEvent).where(ActivityEvent.meeting_id == meeting_id))
    await db.delete(m)
    await db.commit()


class PatchMeetingIn(BaseModel):
    analysis: dict | None = None


@router.patch("/{meeting_id}", response_model=MeetingOut)
async def patch_meeting(meeting_id: str, body: PatchMeetingIn, db=Depends(get_db), _=Depends(get_current_user)):
    """Edit the (still-draft) customer intent / analysis before approval."""
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    if body.analysis is not None:
        m.analysis = body.analysis
    await db.commit()
    await db.refresh(m)
    return m


@router.post("/{meeting_id}/approve")
async def approve_execution(meeting_id: str, db=Depends(get_db), _=Depends(get_current_user)):
    """Finalize the execution plan. For the MVP this only flips state — no external sync."""
    m = await db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found")
    if not m.linked_project_id:
        raise HTTPException(409, "This meeting has no execution plan to approve")
    p = await db.get(Project, m.linked_project_id)
    if not p:
        raise HTTPException(404, "Execution plan not found")

    now = datetime.now(timezone.utc)
    p.approval_status = "approved"
    p.approved_at = now
    p.status = "in-progress"
    db.add(ActivityEvent(
        id=f"ac_{uuid.uuid4().hex[:8]}", actor={"name": "You"}, action="approved the execution plan for",
        target=p.name, target_type="project", at=now, project_id=p.id, meeting_id=m.id,
    ))
    db.add(TimelineEvent(
        id=f"ev_{uuid.uuid4().hex[:8]}", kind="review-approved", title="Execution plan approved",
        description=f"{p.name} approved — ready for synchronization.", at=now, actor="You",
        project_id=p.id, meeting_id=m.id,
    ))
    await db.commit()
    await publish_event("orbit:pipeline", {"type": "execution.approved", "meetingId": m.id, "projectId": p.id})
    return {"meetingId": m.id, "projectId": p.id, "approvalStatus": "approved", "approvedAt": now.isoformat()}
