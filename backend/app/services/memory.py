"""Memory intelligence layer (Phase 3 + 4) — a self-updating company memory on
top of the existing substrate.

A `Memory` is a distilled FACT ("Kodama is working on ENG-432") with confidence,
importance, lifecycle and provenance. Facts are DERIVED from artifacts (their
Extractor output + structured Linear meta — no extra LLM call), DEDUPLICATED by
embedding, and UPDATED as reality changes: a contradicting fact in the same slot
supersedes the old one (kept as history, never deleted). Retrieval ranks facts by
semantic similarity + confidence + recency + importance. Reuses embeddings, the
Extractor's output, the heartbeat and the chat context engine.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..models import Memory
from . import embeddings

logger = logging.getLogger("orbit.memory")

_MERGE_SIM = 0.90  # near-identical fact → reinforce/merge, not a new fact
_STALE_FLOOR = 0.35  # below this a decayed memory is marked stale
_DECAY_AFTER_DAYS = 90  # unverified this long → confidence decays
_DECAY_STEP = 0.15  # 0.90 → 0.75 after one decay window (matches spec)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _norm(fact: str) -> str:
    return " ".join((fact or "").lower().split())


# --- Phase 3: the update engine --------------------------------------------
async def record(
    db,
    ws: str,
    *,
    fact: str,
    kind: str,
    subject: str = "",
    subject_entity_id: str | None = None,
    source_artifact_id: str | None = None,
    source_ref: str = "",
    importance: float = 0.5,
    base_confidence: float = 0.75,
) -> Memory | None:
    """Upsert a fact. Reinforces an existing near-identical fact, supersedes a
    contradicting fact in the same (subject, kind) slot, or creates a new one.
    Idempotent-ish; caller commits. `subject` is the normalized slot key."""
    fact = (fact or "").strip()
    if not fact:
        return None
    subj = _norm(subject)
    now = _now()
    vec = await embeddings.embed_text(fact)

    stmt = select(Memory).where(Memory.workspace_id == ws, Memory.kind == kind, Memory.status == "active")
    if subj:
        stmt = stmt.where(Memory.subject == subj)
    existing = (await db.execute(stmt)).scalars().all()

    # Reinforce a near-duplicate (semantic, then exact-ish text).
    match = None
    if vec:
        best, cand = 0.0, None
        for m in existing:
            if m.embedding:
                s = embeddings.cosine(vec, m.embedding)
                if s > best:
                    best, cand = s, m
        if best >= _MERGE_SIM:
            match = cand
    if match is None:
        match = next((m for m in existing if _norm(m.fact) == _norm(fact)), None)
    if match:
        match.confidence = min(1.0, round(match.confidence + 0.05, 3))
        match.importance = max(match.importance, importance)
        match.last_verified_at = now
        match.updated_at = now
        if source_artifact_id:
            match.source_artifact_id = source_artifact_id
            match.source_ref = source_ref or match.source_ref
        return match

    # New fact in an occupied slot ⇒ the old active fact is superseded (kept).
    mem = Memory(
        id=f"mem_{uuid.uuid4().hex[:12]}",
        workspace_id=ws,
        fact=fact[:1000],
        kind=kind,
        subject=subj,
        subject_entity_id=subject_entity_id,
        confidence=base_confidence,
        importance=importance,
        status="active",
        source_artifact_id=source_artifact_id,
        source_ref=source_ref,
        superseded_by=None,
        history=[],
        last_verified_at=now,
        created_at=now,
        updated_at=now,
        embedding=vec,
    )
    db.add(mem)
    await db.flush()
    if subj:
        for old in existing:
            old.history = (old.history or []) + [
                {"fact": old.fact, "confidence": old.confidence, "at": (old.updated_at or now).isoformat()}
            ]
            old.status = "superseded"
            old.superseded_by = mem.id
            old.updated_at = now
    return mem


async def resolve_slot(db, ws: str, *, kind: str, subject: str) -> int:
    """Close a slot without a replacement fact (e.g. a PR's blocker cleared):
    active facts become superseded, kept as history. Caller commits."""
    subj = _norm(subject)
    if not subj:
        return 0
    rows = (
        (
            await db.execute(
                select(Memory).where(
                    Memory.workspace_id == ws, Memory.kind == kind, Memory.subject == subj, Memory.status == "active"
                )
            )
        )
        .scalars()
        .all()
    )
    now = _now()
    for m in rows:
        m.history = (m.history or []) + [
            {"fact": m.fact, "confidence": m.confidence, "at": now.isoformat(), "resolved": True}
        ]
        m.status = "superseded"
        m.updated_at = now
    return len(rows)


_WORK_SOURCES = {"linear-issue": "Linear", "github-pr": "GitHub", "github-issue": "GitHub"}


def _ref(artifact) -> str:
    label = _WORK_SOURCES.get(artifact.source)
    if label:
        return f"{label} {(artifact.meta or {}).get('identifier') or artifact.external_ref or ''}".strip()
    return (artifact.title or artifact.source)[:80]


async def derive_from_artifact(db, ws: str, artifact) -> int:
    """Distil facts from one artifact — deterministic ownership/assignment from
    the work item's meta (any connector, one key vocabulary) + decisions from the
    Extractor. No extra LLM call. Returns count."""
    n = 0
    m = artifact.meta or {}

    if artifact.source in _WORK_SOURCES and m.get("assignee") and m.get("stateType") not in ("completed", "canceled"):
        ident = m.get("identifier") or artifact.external_ref or ""
        title = artifact.title.split("·", 1)[-1].strip() if "·" in artifact.title else artifact.title
        fact = f"{m['assignee']} is working on {ident} · {title}"
        if m.get("project"):
            fact += f" (project: {m['project']})"
        if await record(
            db,
            ws,
            fact=fact,
            kind="assignment",
            subject=ident,
            subject_entity_id=None,
            source_artifact_id=artifact.id,
            source_ref=_ref(artifact),
            importance=0.7,
            base_confidence=0.9,
        ):
            n += 1

    if artifact.source == "github-pr":
        ident = m.get("identifier") or artifact.external_ref or ""
        blocked_by = [
            r.get("reviewer") or "a reviewer" for r in (m.get("reviews") or []) if r.get("state") == "CHANGES_REQUESTED"
        ]
        if m.get("stateType") not in ("completed", "canceled") and blocked_by:
            fact = f"{ident} is blocked: changes requested by {blocked_by[-1]}"
            if await record(
                db,
                ws,
                fact=fact,
                kind="blocker",
                subject=ident,
                source_artifact_id=artifact.id,
                source_ref=_ref(artifact),
                importance=0.8,
                base_confidence=0.9,
            ):
                n += 1
        else:
            await resolve_slot(db, ws, kind="blocker", subject=ident)

    for d in (artifact.extracted or {}).get("decisions", []) or []:
        if (d or "").strip() and await record(
            db,
            ws,
            fact=d.strip(),
            kind="decision",
            source_artifact_id=artifact.id,
            source_ref=_ref(artifact),
            importance=0.6,
            base_confidence=0.7,
        ):
            n += 1
    return n


async def backfill_embeddings(db, ws: str, limit: int = 100) -> int:
    """Embed facts whose write-time embedding failed (quota outages) so ranked
    retrieval sees the whole memory. Heartbeat path; caller commits."""
    if not embeddings.available():
        return 0
    rows = (
        (
            await db.execute(
                select(Memory)
                .where(
                    Memory.workspace_id == ws, Memory.embedding.is_(None), Memory.status.in_(("active", "superseded"))
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0
    vectors = await embeddings.embed_many([m.fact for m in rows])
    filled = 0
    for m, v in zip(rows, vectors):
        if v:
            m.embedding = v
            filled += 1
    return filled


# --- Phase 3: decay (runs in the heartbeat) --------------------------------
async def decay(db, ws: str) -> int:
    """Unverified facts slowly lose confidence; below a floor they go stale.
    Never deletes — history is preserved. Caller commits. Returns rows changed."""
    cutoff = _now() - timedelta(days=_DECAY_AFTER_DAYS)
    rows = (
        (
            await db.execute(
                select(Memory).where(
                    Memory.workspace_id == ws, Memory.status == "active", Memory.last_verified_at < cutoff
                )
            )
        )
        .scalars()
        .all()
    )
    for m in rows:
        m.confidence = round(max(0.1, m.confidence - _DECAY_STEP), 3)
        if m.confidence <= _STALE_FLOOR:
            m.status = "stale"
        m.updated_at = _now()
    return len(rows)


# --- Phase 4: ranked retrieval ---------------------------------------------
def _aware(ts: datetime | None) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC so arithmetic is safe."""
    if ts is None:
        return _now()
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _recency(m: Memory) -> float:
    days = (_now() - _aware(m.last_verified_at or m.created_at)).days
    return max(0.0, 1.0 - days / 180.0)  # 1.0 now → 0 at ~6 months


def _rank(m: Memory, sim: float) -> float:
    """Combined relevance: semantic + confidence + recency + importance."""
    return round(0.5 * sim + 0.25 * m.confidence + 0.15 * _recency(m) + 0.10 * m.importance, 4)


async def search(
    db, ws: str, query_vector, k: int = 6, statuses: tuple[str, ...] = ("active",)
) -> list[tuple[Memory, float]]:
    """Top-k memories for a query vector, ranked by the combined score. Pass
    statuses=('active','superseded') for historical ('who owned X last month')."""
    rows = (
        (await db.execute(select(Memory).where(Memory.workspace_id == ws, Memory.status.in_(statuses)))).scalars().all()
    )
    scored = [(m, _rank(m, embeddings.cosine(query_vector, m.embedding))) for m in rows if m.embedding]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
