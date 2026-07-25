"""The learning loop — Orbit generates differently because humans corrected it.

Human edits and dismissals are captured as Feedback AND vectorized into a
permanent repository of behavioral preferences & rules. Two retrieval modes:

- ``render_corrections`` — the most RECENT corrections, injected into the
  Extractor and Reasoner (which have no natural query to match against).
- ``relevant_rules`` / ``directives_block`` — the corrections most RELEVANT to a
  given query (native pgvector ``<=>`` on Postgres, Python cosine on SQLite),
  injected into the chat agent's system prompt as <System_Directives> so it
  doesn't repeat a mistake the team already corrected.

Writes are synchronous on the request path (a human action, not high-frequency);
reads are strictly read-only.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import cast, select

from ..database import engine
from ..models import EMBEDDING_DIM, Feedback
from . import embeddings

_MAX_CORRECTIONS = 8
_RULE_MAX_DISTANCE = 0.40


def _now() -> datetime:
    return datetime.now(timezone.utc)


def rule_text(section: str, field: str, before: str, after: str, context: str = "") -> str:
    """Render one correction as a natural-language behavioral rule — the text we
    embed (so it is retrievable by topic) and the text we inject as a directive."""
    ctx = f" (on: {context})" if context else ""
    if field == "dismiss":
        reason = after or "not relevant"
        return f'The team dismissed a {section}{ctx}: "{before}". Reason: {reason}. Surface fewer like it.'
    if field == "rating":
        # after = "up: <answer snippet>" | "down: <answer snippet>"
        verdict = after.split(":", 1)[0].strip()
        if verdict == "down":
            return f'The team rated a chat answer UNHELPFUL for the question "{before}". Answer questions like it better — be specific and evidence-backed.'
        return f'The team rated a chat answer HELPFUL for the question "{before}". Keep answering questions like it the same way.'
    instead = f' instead of "{before}"' if before else ""
    return f'When producing the {field} of a {section}{ctx}, the team prefers "{after}"{instead}.'


async def record_feedback(
    db,
    workspace_id: str,
    *,
    section: str,
    field: str,
    before: str,
    after: str,
    context: str = "",
    user_id: str | None = None,
) -> Feedback:
    """Persist one correction AND its embedding, synchronously (the write path).
    `user_id` set = a PER-PERSON signal (e.g. a chat answer rating); None = a
    team-wide correction.

    The embedding is None when embeddings are unavailable (AI off / no key) —
    stored as SQL NULL and backfilled later. Caller commits."""
    text = rule_text(section, field, before, after, context)
    fb = Feedback(
        id=f"fb_{uuid.uuid4().hex[:8]}",
        workspace_id=workspace_id,
        user_id=user_id,
        section=section,
        field=field,
        before=(before or "")[:280],
        after=(after or "")[:280],
        embedding=await embeddings.embed_text(text),
        created_at=_now(),
    )
    db.add(fb)
    return fb


async def backfill_embeddings(db, workspace_id: str, limit: int = 100) -> int:
    """Embed corrections whose vector is missing — written with AI off, or
    cleared by an embedding-model switch — so learned rules stay semantically
    retrievable. Caller commits."""
    if not embeddings.available():
        return 0
    rows = (
        (
            await db.execute(
                select(Feedback)
                .where(Feedback.workspace_id == workspace_id, Feedback.embedding.is_(None))
                .order_by(Feedback.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    done = 0
    for r in rows:
        vec = await embeddings.embed_text(rule_text(r.section, r.field, r.before, r.after))
        if vec is None:
            break  # embeddings just became unavailable (quota breaker) — retry next tick
        r.embedding = vec
        done += 1
    return done


async def render_corrections(db, workspace_id: str) -> str:
    """The most recent human corrections as a compact prompt block, or '' when
    there's nothing learned yet. (Recency-based; used where there's no query.)"""
    rows = (
        (
            await db.execute(
                select(Feedback)
                .where(Feedback.workspace_id == workspace_id)
                .order_by(Feedback.created_at.desc())
                .limit(_MAX_CORRECTIONS)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return ""
    lines = [
        "LEARNED CORRECTIONS — how humans edited or dismissed Orbit's recent output. "
        "Match these preferences (tone, specificity, what's worth surfacing):"
    ]
    for r in rows:
        lines.append(f'- [{r.section}.{r.field}] "{r.before}" → "{r.after}"')
    return "\n".join(lines)


async def relevant_rules(
    db, workspace_id: str, query_text: str, k: int = 3, *, user_id: str | None = None
) -> list[Feedback]:
    """The behavioral rules most relevant to `query_text` — STRICTLY READ-ONLY.
    `user_id` None → team-wide rules (Feedback.user_id IS NULL); set → that one
    person's rules (their chat answer ratings).

    Native pgvector cosine distance (`<=>`) on Postgres; Python cosine on SQLite.
    Returns [] when embeddings are unavailable or nothing is relevant."""
    if not embeddings.available() or not (query_text or "").strip():
        return []
    qv = await embeddings.embed_query(query_text)
    if not qv:
        return []
    scope = (Feedback.user_id == user_id) if user_id else Feedback.user_id.is_(None)

    if engine.dialect.name == "postgresql":
        distance = cast(Feedback.embedding, Vector(EMBEDDING_DIM)).cosine_distance(qv)
        stmt = (
            select(Feedback)
            .where(
                Feedback.workspace_id == workspace_id,
                scope,
                Feedback.embedding.isnot(None),
                distance <= _RULE_MAX_DISTANCE,
            )
            .order_by(distance)
            .limit(k)
        )
        return list((await db.execute(stmt)).scalars().all())

    rows = (
        (
            await db.execute(
                select(Feedback).where(Feedback.workspace_id == workspace_id, scope, Feedback.embedding.isnot(None))
            )
        )
        .scalars()
        .all()
    )
    floor = 1.0 - _RULE_MAX_DISTANCE
    scored = [(r, embeddings.cosine(qv, r.embedding)) for r in rows if r.embedding]
    scored = [(r, s) for r, s in scored if s >= floor]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [r for r, _ in scored[:k]]


async def directives_block(db, workspace_id: str, query_text: str, k: int = 3, *, user_id: str | None = None) -> str:
    """The relevant behavioral rules formatted as a <System_Directives> block for
    system-prompt injection, or '' when there are none. `user_id` set → that
    person's own feedback (e.g. chat answer ratings); None → team corrections."""
    rules = await relevant_rules(db, workspace_id, query_text, k=k, user_id=user_id)
    if not rules:
        return ""
    body = "\n".join(f"- {rule_text(r.section, r.field, r.before, r.after)}" for r in rules)
    whose = "your own past feedback" if user_id else "this team's past corrections"
    return (
        f"\n\n<System_Directives> (learned from {whose} — honor them "
        f"unless the user explicitly overrides)\n{body}\n</System_Directives>"
    )
