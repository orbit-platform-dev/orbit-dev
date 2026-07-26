"""Ingestion — the Observe + Remember half of the loop.

One entry point (`ingest_artifact`) writes any observed item into unified memory:
it creates the Artifact, runs the Extractor over it, embeds it for semantic
retrieval, and persists. `pull_linear` is the first sensor: it reads Linear
issues (open + recently completed) and ingests them as artifacts, idempotently.

The legacy Meeting pipeline is untouched; this is the new memory substrate.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

from sqlalchemy import delete, func, select, update

from ..agents.extractor import extract
from ..models import Artifact, ArtifactChunk, Integration
from . import embeddings, fireflies, github, google_drive, linear, slack, vision

logger = logging.getLogger("orbit.ingestion")


_EMBED_WINDOW = 6000


def _embed_input(title: str, content: str) -> str:
    """The exact text embedded for an artifact — title plus a bounded slice of
    content. Defined once so ingest and backfill embed identically (and match
    what the query side expects). The slice is the model's real single-vector
    capacity; content beyond it is made searchable by per-chunk embeddings
    (see _write_chunks), not by a bigger single vector (which would just dilute)."""
    return f"{title}\n{(content or '')[:_EMBED_WINDOW]}"


# Passage-level retrieval for long documents. Only content beyond _EMBED_WINDOW
# needs it (the artifact's own vector covers the opening), so short items make no
# chunks. _MAX_EMBED_CHUNKS caps vectors per doc at ~10 pages of coverage; text
# past that still lives in Artifact.content (readable once the doc is surfaced).
_CHUNK_SIZE = 1500
_CHUNK_OVERLAP = 200
_MAX_EMBED_CHUNKS = 16


def _split_chunks(text: str) -> list[str]:
    """Overlapping windows over long content. Returns [] for content that fits in
    the artifact-level embedding, so most items create zero chunk rows."""
    t = (text or "").strip()
    if len(t) <= _EMBED_WINDOW:
        return []
    step = _CHUNK_SIZE - _CHUNK_OVERLAP
    out: list[str] = []
    for start in range(0, len(t), step):
        piece = t[start : start + _CHUNK_SIZE].strip()
        if piece:
            out.append(piece)
        if len(out) >= _MAX_EMBED_CHUNKS:
            break
    return out


async def _write_chunks(db, art: Artifact) -> None:
    """(Re)build a long artifact's embedded chunk rows so any passage in it is
    searchable, not just its opening. Hash-guarded: content unchanged since the
    last chunking is a no-op, so calling it on every refresh never storms the
    embedding API. Caller commits. Embedding-unavailable / short content ⇒ no rows."""
    pieces = _split_chunks(art.content)
    ch = hashlib.md5((art.content or "").encode()).hexdigest() if pieces else ""
    meta = art.meta or {}
    if pieces and meta.get("chunkHash") == ch:
        return  # already chunked this exact content
    await db.execute(delete(ArtifactChunk).where(ArtifactChunk.artifact_id == art.id))
    if not pieces or not embeddings.available():
        if not pieces and meta.get("chunkHash"):
            art.meta = {**meta, "chunkHash": ""}  # shrank below threshold — forget old chunks
        return
    vecs = await embeddings.embed_many(pieces)
    wrote = 0
    for i, (piece, vec) in enumerate(zip(pieces, vecs)):
        if not vec:
            continue
        db.add(
            ArtifactChunk(
                id=f"ch_{uuid.uuid4().hex[:12]}",
                workspace_id=art.workspace_id,
                artifact_id=art.id,
                source=art.source,
                chunk_index=i,
                text=piece,
                embedding=vec,
            )
        )
        wrote += 1
    if wrote:  # only claim the hash once vectors actually landed (else retry next tick)
        art.meta = {**meta, "chunkHash": ch}


SOURCE_BY_INTEGRATION: dict[str, list[str]] = {
    "linear": ["linear-issue"],
    "slack": ["slack-message"],
    "github": ["github-pr", "github-issue"],
    "google-drive": ["gdrive-doc", "gdrive-sheet", "gdrive-slides", "gdrive-pdf", "gdrive-image"],
    "fireflies": ["fireflies"],
    "circleback": ["circleback"],
}


async def set_source_stale(db, workspace_id: str, integration_key: str, stale: bool) -> int:
    """Disconnect keeps a connector's artifacts but flags them `stale` ('no longer
    syncing'); reconnect clears the flag. Caller commits. Returns rows changed."""
    sources = SOURCE_BY_INTEGRATION.get(integration_key)
    if not sources:
        return 0
    if stale:
        stmt = (
            update(Artifact)
            .where(Artifact.workspace_id == workspace_id, Artifact.source.in_(sources), Artifact.status != "stale")
            .values(status="stale")
        )
    else:
        stmt = (
            update(Artifact)
            .where(Artifact.workspace_id == workspace_id, Artifact.source.in_(sources), Artifact.status == "stale")
            .values(status="extracted")
        )
    return (await db.execute(stmt)).rowcount


_FULL_SYNC_EVERY_HOURS = 24
_CURSOR_OVERLAP_MINUTES = 5
_RECONCILE_CHECKS = 50
_INITIAL_BACKFILL_DAYS = 7

_IMAGE_MD = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)")
_IMAGES_PER_SYNC = 5  # vision reads spend model quota — bounded per pull


async def _fold_images(content: str, *, auth: str | None, prev: dict, budget: list[int]) -> tuple[str, dict[str, str]]:
    """Read markdown-embedded images (issue/PR descriptions and comments) with
    the vision model and fold what they say into the artifact content, so it
    reaches extraction, embeddings and chat. Each image is read ONCE: descriptions
    cache in meta.imageTexts keyed by the URL sans query (Linear re-signs URLs on
    every fetch); dead links cache as "" so they never burn budget again."""
    urls = list(dict.fromkeys(_IMAGE_MD.findall(content)))[:5]
    texts: dict[str, str] = {}
    for url in urls:
        key = url.partition("?")[0]
        if key in prev:
            texts[key] = prev[key]
        elif budget[0] > 0:
            budget[0] -= 1
            got = await vision.fetch_image(url, auth)
            if got is None:
                texts[key] = ""
                continue
            desc = (await vision.transcribe(*got, name=key.rsplit("/", 1)[-1]))[:800]
            if desc:
                texts[key] = desc
    block = "\n".join(f"- {d}" for d in texts.values() if d)
    if block:
        content += "\n\nImages:\n" + block
    return content, texts


async def _sync_plan(db, workspace_id: str, key: str):
    """(since_iso, integration) for a connector.
    First connect (no cursor) ⇒ a bounded INITIAL_BACKFILL window: a cold start
    ingests recent history, not years of it, and the cursor grows it forward. With
    a cursor and 24h+ since the last full pass ⇒ since=None, an unbounded reconcile
    that also catches deletions. Otherwise ⇒ incremental from the cursor.
    (since=None ⇒ full/reconcile; a timestamp ⇒ bounded/incremental.)"""
    from ..models import Integration

    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": key})
    if not integ:
        return None, None
    st = integ.sync_state or {}
    if not st.get("cursor"):
        return (datetime.now(timezone.utc) - timedelta(days=_INITIAL_BACKFILL_DAYS)).isoformat(), integ
    last_full = _parse_ts(st.get("lastFull"))
    stale_full = not last_full or (datetime.now(timezone.utc) - last_full) >= timedelta(hours=_FULL_SYNC_EVERY_HOURS)
    return (None if stale_full else st["cursor"]), integ


def _advance_cursor(integ, *, full: bool, at: datetime | None = None) -> None:
    if not integ:
        return
    now = datetime.now(timezone.utc)
    st = dict(integ.sync_state or {})
    # Anchor the cursor to when the data was FETCHED, not when the (possibly
    # long) apply finished — anything updated in between must be seen next tick.
    st["cursor"] = ((at or now) - timedelta(minutes=_CURSOR_OVERLAP_MINUTES)).isoformat()
    # The first advance (initial backfill) sets the reconcile baseline too, so the
    # very next tick stays incremental instead of immediately running a full pull.
    if full or not st.get("lastFull"):
        st["lastFull"] = now.isoformat()
    integ.sync_state = st


def _image_budget(integ) -> list[int]:
    first = bool(integ) and not ((integ.sync_state or {}).get("cursor"))
    return [0 if first else _IMAGES_PER_SYNC]


class _Prefetch(NamedTuple):
    auth: Any = None
    since: str | None = None
    integ: Integration | None = None
    fetch: Any = None
    data: Any = None
    exc: Exception | None = None
    fetched_at: datetime | None = None


async def _resolve(pre: _Prefetch) -> _Prefetch:
    if not pre.auth or pre.fetch is None:
        return pre
    try:
        data = await pre.fetch()
    except Exception as exc:
        return pre._replace(exc=exc, fetched_at=datetime.now(timezone.utc))
    return pre._replace(data=data, fetched_at=datetime.now(timezone.utc))


def _parse_ts(value: str | None) -> datetime | None:
    """Linear ISO timestamp → tz-aware datetime, so issues land on the real
    timeline (drives the Memory time filter). None on anything unparseable."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_slack_ts(ts: str | None) -> datetime | None:
    """Slack ts ('1728... .000200' epoch seconds) → tz-aware datetime."""
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc) if ts else None
    except (ValueError, TypeError):
        return None


def _parse_epoch_ms(value) -> datetime | None:
    """Fireflies `date` is epoch milliseconds (a number) → tz-aware datetime.
    Tolerates seconds too. Non-numeric (e.g. ISO) → None, so callers fall back
    to _parse_ts."""
    try:
        v = float(value)
    except (ValueError, TypeError):
        return None
    if v > 1e12:  # milliseconds
        v /= 1000.0
    return datetime.fromtimestamp(v, tz=timezone.utc)


_AUTH_SIGNALS = (
    "401",
    "unauthorized",
    "invalid_auth",
    "missing_scope",
    "authentication required",
    "not authenticated",
    "token refresh failed",
    "invalid_grant",
    "token expired",
)


async def _note_sync_health(db, integ: Integration | None, exc: Exception | None) -> None:
    """Surface a dead connection instead of failing silently. On an auth-looking
    failure, flip a connected integration to 'reconnect' so the UI prompts a
    re-auth (a new OAuth scope or a token with no refresh token can only be fixed
    by reconnecting). On a clean pull, clear a prior 'reconnect' — self-healing,
    so a transient error that trips it never sticks. Caller need not commit."""
    if not integ:
        return
    if exc is not None:
        if integ.status == "connected" and any(s in str(exc).lower() for s in _AUTH_SIGNALS):
            integ.status = "reconnect"
            await db.commit()
    elif integ.status == "reconnect":
        integ.status = "connected"
        await db.commit()


async def ingest_artifact(
    db,
    workspace_id: str,
    *,
    source: str,
    kind: str,
    title: str,
    content: str,
    external_ref: str | None = None,
    url: str | None = None,
    occurred_at: datetime | None = None,
    meta: dict | None = None,
) -> Artifact:
    """Create (or return the existing) artifact, extract, embed, persist.

    Idempotent by (workspace, source, external_ref) so re-pulling a sensor never
    duplicates memory.
    """
    if external_ref:
        existing = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == source,
                        Artifact.external_ref == external_ref,
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing:
            return existing

    now = datetime.now(timezone.utc)
    art = Artifact(
        id=f"art_{uuid.uuid4().hex[:12]}",
        workspace_id=workspace_id,
        source=source,
        kind=kind,
        external_ref=external_ref,
        url=url,
        title=title[:300],
        content=content or "",
        meta=meta or {},
        status="observed",
        occurred_at=occurred_at or now,
        created_at=now,
    )
    db.add(art)
    await db.flush()

    from .learning import render_corrections

    corrections = await render_corrections(db, workspace_id)
    extraction = await extract(kind, art.title, art.content, corrections)
    art.extracted = extraction.model_dump(by_alias=True)
    art.status = "extracted"
    # Embed eagerly, HERE on the write path, so retrieval and commitment matching
    # stay strictly read-only (no writes-during-reads / write contention) and the
    # pgvector HNSW index is populated the moment memory lands. None when
    # embeddings are unavailable (AI off / no key) — callers degrade to
    # keyword+recency, and backfill_embeddings fills the gap once AI is on.
    art.embedding = await embeddings.embed_text(_embed_input(art.title, art.content))
    # Long content: also embed it in overlapping chunks so a passage deep inside
    # is searchable, not just the opening the single vector above captures.
    await _write_chunks(db, art)

    await db.commit()
    await db.refresh(art)

    # Understand: fold this artifact into the company model (entities + links).
    from .model import build_from_artifact

    await build_from_artifact(db, workspace_id, art)
    # Distil durable facts (confidence + lifecycle) from it.
    from .memory import derive_from_artifact

    await derive_from_artifact(db, workspace_id, art)
    await db.commit()
    return art


def _cycle_time_days(created: str | None, completed: str | None) -> float | None:
    """How long the ticket took to close (created → completed), in days."""
    c1, c2 = _parse_ts(created), _parse_ts(completed)
    if c1 and c2 and c2 >= c1:
        return round((c2 - c1).total_seconds() / 86400, 1)
    return None


def _linear_content_meta(s: dict) -> tuple[str, dict]:
    """Turn a shaped Linear issue into the full memory text (what the LLM and the
    embedding see) + structured meta (what reasoning/UI read). This is the whole
    ticket — owner, project, team, labels, priority, dates, cycle time — not just
    name + description."""
    cycle = _cycle_time_days(s.get("createdAt"), s.get("completedAt"))
    blocks = [f"{s['identifier']} · {s['title']}"]
    if s.get("description"):
        blocks.append(s["description"])
    facts = [
        f"Status: {s.get('state', '')} ({s.get('stateType', '')})",
        f"Assignee: {s.get('assignee') or 'unassigned'}",
        f"Team: {s.get('team') or '—'}",
        f"Project: {s.get('project') or '—'}",
    ]
    if s.get("priorityLabel"):
        facts.append(f"Priority: {s['priorityLabel']}")
    if s.get("estimate") is not None:
        facts.append(f"Estimate: {s['estimate']}")
    if s.get("labels"):
        facts.append("Labels: " + ", ".join(s["labels"]))
    if s.get("creator"):
        facts.append(f"Created by: {s['creator']}")
    if s.get("createdAt"):
        facts.append(f"Created: {s['createdAt']}")
    if s.get("completedAt"):
        facts.append(f"Completed: {s['completedAt']}")
    if cycle is not None:
        facts.append(f"Time to close: {cycle} days")
    blocks.append(" · ".join(facts))

    # The discussion — decisions, blockers and technical context live in comments.
    comments = s.get("comments") or []
    if comments:
        discussion = "\n".join(f"- {c.get('author') or 'someone'}: {c.get('body')}" for c in comments if c.get("body"))
        if discussion:
            blocks.append("Discussion:\n" + discussion)
    content = "\n\n".join(blocks)

    meta = {
        k: s.get(k)
        for k in (
            "identifier",
            "state",
            "stateType",
            "createdAt",
            "updatedAt",
            "startedAt",
            "completedAt",
            "dueDate",
            "assignee",
            "assigneeEmail",
            "creator",
            "team",
            "teamKey",
            "project",
            "projectState",
            "labels",
            "priority",
            "priorityLabel",
            "estimate",
        )
    }
    meta["cycleTimeDays"] = cycle
    meta["comments"] = comments
    meta["commentCount"] = len(comments)
    return content, meta


def _classify_change(old_content: str, new_content: str) -> set[str]:
    """Typed change detection: 'window' = the embedded head changed (vector is
    stale), 'tail' = only deep content moved (chunks cover it). Empty = no state
    change — graph-relevant fields (assignee/status/labels) are folded into
    content, so they classify too."""
    old, new = old_content or "", new_content or ""
    if old == new:
        return set()
    if old[:_EMBED_WINDOW] != new[:_EMBED_WINDOW]:
        return {"window"}
    return {"tail"}


async def _refresh_embedding(existing, content: str, changes: set[str], imgs: dict, prev_imgs: dict) -> None:
    """Keep the opening vector faithful to current content; unchanged items never
    re-embed, so routine refreshes still cost nothing."""
    if not embeddings.available():
        return
    if "window" in changes or (imgs and imgs != prev_imgs):
        vec = await embeddings.embed_text(_embed_input(existing.title, content))
        if vec:
            existing.embedding = vec


async def _plan_linear(db, workspace_id: str) -> _Prefetch:
    auth = await linear.get_auth(db, workspace_id)
    if not auth:
        return _Prefetch()
    since, integ = await _sync_plan(db, workspace_id, "linear")

    async def fetch():
        return await linear.fetch_open_issues(auth, since=since) + await linear.fetch_completed_issues(
            auth, since=since
        )

    return _Prefetch(auth=auth, since=since, integ=integ, fetch=fetch)


async def pull_linear(
    db, workspace_id: str, pre: _Prefetch | None = None, *, match_commitments: bool = True, stats: dict | None = None
) -> int:
    """Ingest Linear issues as full-context artifacts. Returns the count of NEW
    artifacts (existing ones are REFRESHED in place, so a re-pull enriches the
    whole backlog with new fields — owner, project, labels, cycle time).

    Honest when Linear isn't connected (returns 0) and on API failure (logs,
    returns what it managed) — never fabricates.
    """
    if pre is None:
        pre = await _resolve(await _plan_linear(db, workspace_id))
    if not pre.auth:
        return 0
    auth, since, integ = pre.auth, pre.since, pre.integ
    if pre.exc is not None:
        logger.warning("Linear pull failed", exc_info=pre.exc)
        await _note_sync_health(db, integ, pre.exc)
        return 0
    issues = pre.data

    ingested = 0
    changed = 0
    img_budget = _image_budget(integ)
    for issue in issues:
        content, meta = _linear_content_meta(issue)
        existing = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == "linear-issue",
                        Artifact.external_ref == issue["identifier"],
                    )
                )
            )
            .scalars()
            .first()
        )
        prev_imgs = (existing.meta or {}).get("imageTexts") or {} if existing else {}
        content, imgs = await _fold_images(content, auth=auth, prev=prev_imgs, budget=img_budget)
        if imgs:
            meta["imageTexts"] = imgs
        if existing:
            changes = _classify_change(existing.content, content)
            existing.meta = meta
            existing.occurred_at = _parse_ts(issue.get("updatedAt")) or existing.occurred_at
            if not changes:
                continue
            changed += 1
            existing.content = content
            await _refresh_embedding(existing, content, changes, imgs, prev_imgs)
            await _write_chunks(db, existing)  # rebuild chunks if the discussion grew long
            # Enrich the ownership graph on every refresh (backfills existing issues).
            from .model import link_work_entities

            await link_work_entities(db, workspace_id, existing)
            # Re-derive facts so reassignments supersede the prior owner.
            from .memory import derive_from_artifact

            await derive_from_artifact(db, workspace_id, existing)
            continue
        await ingest_artifact(
            db,
            workspace_id,
            source="linear-issue",
            kind="issue",
            title=f"{issue['identifier']} · {issue['title']}",
            content=content,
            external_ref=issue["identifier"],
            url=issue.get("url"),
            occurred_at=_parse_ts(issue.get("updatedAt")),
            meta=meta,
        )
        ingested += 1

    if since is None:
        seen = {i["identifier"] for i in issues}
        rows = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == "linear-issue",
                        Artifact.status != "stale",
                    )
                )
            )
            .scalars()
            .all()
        )
        for a in rows:
            if (
                a.external_ref
                and a.external_ref not in seen
                and (a.meta or {}).get("stateType") not in ("completed", "canceled")
            ):
                a.status = "stale"

    await _note_sync_health(db, integ, None)
    _advance_cursor(integ, full=since is None, at=pre.fetched_at)
    await db.commit()
    if stats is not None:
        stats["changed"] = stats.get("changed", 0) + changed
    if match_commitments and (ingested or changed):
        from .model import match_open_commitments

        await match_open_commitments(db, workspace_id)
    return ingested


def _github_content_meta(s: dict) -> tuple[str, dict]:
    """Shaped GitHub PR/issue → memory text + structured meta. Meta reuses the
    Linear key vocabulary (assignee/creator/project/stateType) so the knowledge
    graph, memory facts and analytics treat every connector identically."""
    kind_label = "PR" if s.get("isPr") else "Issue"
    blocks = [f"{s['identifier']} · {s['title']}"]
    if s.get("description"):
        blocks.append(s["description"][:3000])
    facts = [
        f"Type: GitHub {kind_label}",
        f"Status: {s.get('state', '')}",
        f"Author: {s.get('author') or '—'}",
        f"Assignee: {s.get('assignee') or 'unassigned'}",
        f"Repo: {s.get('repo') or '—'}",
    ]
    if s.get("labels"):
        facts.append("Labels: " + ", ".join(s["labels"]))
    if s.get("draft"):
        facts.append("Draft PR")
    if s.get("createdAt"):
        facts.append(f"Created: {s['createdAt']}")
    if s.get("mergedAt"):
        facts.append(f"Merged: {s['mergedAt']}")
    if s.get("additions") is not None:
        facts.append(
            f"Code: +{s['additions']} / -{s.get('deletions', 0)} across "
            f"{s.get('changedFiles', '?')} files · {s.get('commits', '?')} commits"
        )
    blocks.append(" · ".join(facts))

    # Reviews + discussion — where blockers and technical decisions live.
    reviews = s.get("reviews") or []
    if reviews:
        blocks.append(
            "Reviews:\n"
            + "\n".join(
                f"- {r.get('reviewer') or 'someone'} ({r.get('state', '').lower().replace('_', ' ')})"
                + (f": {r['body']}" if r.get("body") else "")
                for r in reviews
            )
        )
    comments = s.get("comments") or []
    if comments:
        blocks.append(
            "Discussion:\n"
            + "\n".join(f"- {c.get('author') or 'someone'}: {c.get('body')}" for c in comments if c.get("body"))
        )

    meta = {
        "identifier": s.get("identifier"),
        "state": s.get("state"),
        "stateType": s.get("stateType"),
        "createdAt": s.get("createdAt"),
        "updatedAt": s.get("updatedAt"),
        "completedAt": s.get("mergedAt") or s.get("closedAt"),
        "assignee": s.get("assignee"),
        "creator": s.get("author"),
        "project": s.get("repo"),
        "labels": s.get("labels") or [],
        "draft": s.get("draft"),
        "isPr": s.get("isPr"),
        "comments": comments,
        "commentCount": len(comments),
        "reviews": reviews,
        "additions": s.get("additions"),
        "deletions": s.get("deletions"),
        "changedFiles": s.get("changedFiles"),
        "commits": s.get("commits"),
    }
    return "\n\n".join(blocks), meta


async def _plan_github(db, workspace_id: str) -> _Prefetch:
    auth = await github.get_auth(db, workspace_id)
    if not auth:
        return _Prefetch()
    since, integ = await _sync_plan(db, workspace_id, "github")

    async def fetch():
        return await github.fetch_work(auth, since=since)

    return _Prefetch(auth=auth, since=since, integ=integ, fetch=fetch)


async def pull_github(
    db, workspace_id: str, pre: _Prefetch | None = None, *, match_commitments: bool = True, stats: dict | None = None
) -> int:
    """Ingest GitHub PRs + issues as artifacts — same idempotent refresh-in-place
    contract as pull_linear. Honest when not connected (0) / on failure."""
    if pre is None:
        pre = await _resolve(await _plan_github(db, workspace_id))
    if not pre.auth:
        return 0
    auth, since, integ = pre.auth, pre.since, pre.integ
    if pre.exc is not None:
        logger.warning("GitHub pull failed", exc_info=pre.exc)
        await _note_sync_health(db, integ, pre.exc)
        return 0
    items, contributors = pre.data

    ingested = 0
    changed = 0
    img_budget = _image_budget(integ)
    for item in items:
        source = "github-pr" if item.get("isPr") else "github-issue"
        content, meta = _github_content_meta(item)
        existing = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == source,
                        Artifact.external_ref == item["identifier"],
                    )
                )
            )
            .scalars()
            .first()
        )
        prev_imgs = (existing.meta or {}).get("imageTexts") or {} if existing else {}
        content, imgs = await _fold_images(content, auth=auth, prev=prev_imgs, budget=img_budget)
        if imgs:
            meta["imageTexts"] = imgs
        if existing:
            changes = _classify_change(existing.content, content)
            existing.meta = meta
            existing.occurred_at = _parse_ts(item.get("updatedAt")) or existing.occurred_at
            if not changes:
                continue
            changed += 1
            existing.content = content
            await _refresh_embedding(existing, content, changes, imgs, prev_imgs)
            await _write_chunks(db, existing)  # rebuild chunks if the discussion grew long
            from .model import link_work_entities

            await link_work_entities(db, workspace_id, existing)
            from .memory import derive_from_artifact

            await derive_from_artifact(db, workspace_id, existing)
            continue
        await ingest_artifact(
            db,
            workspace_id,
            source=source,
            kind="pr" if item.get("isPr") else "issue",
            title=f"{item['identifier']} · {item['title']}"[:300],
            content=content,
            external_ref=item["identifier"],
            url=item.get("url"),
            occurred_at=_parse_ts(item.get("updatedAt")),
            meta=meta,
        )
        ingested += 1

    # Contributors: every repo's people join the graph (Person -works_on-> repo)
    # and memory learns who actually builds what.
    from .memory import record
    from .model import ensure_link, is_bot, resolve_entity, resolve_person

    for repo, people in (contributors or {}).items():
        proj = await resolve_entity(db, workspace_id, "project", repo)
        for p in people:
            if is_bot(p.get("login")):
                continue
            ent = await resolve_person(db, workspace_id, p["login"], handle=p["login"])
            if ent and proj:
                await ensure_link(db, workspace_id, "entity", ent.id, "entity", proj.id, "works_on")
            await record(
                db,
                workspace_id,
                fact=f"{p['login']} is a contributor to {repo} ({p['contributions']} commits)",
                kind="context",
                subject=f"contrib:{repo}:{p['login']}",
                source_ref=f"GitHub {repo}",
                importance=0.4,
                base_confidence=0.85,
            )

    # Reconcile on FULL syncs: open items missing from the (capped) listing get a
    # live probe — gone → stale; merged/closed outside the window → state fixed;
    # still open → just outside the cap, untouched.
    if since is None:
        seen = {i["identifier"] for i in items}
        rows = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source.in_(("github-pr", "github-issue")),
                        Artifact.status != "stale",
                    )
                )
            )
            .scalars()
            .all()
        )
        missing = [
            a
            for a in rows
            if a.external_ref
            and a.external_ref not in seen
            and (a.meta or {}).get("stateType") not in ("completed", "canceled")
        ]
        random.shuffle(missing)
        for a in missing[:_RECONCILE_CHECKS]:
            try:
                state = await github.item_state(auth, a.external_ref, a.source == "github-pr")
            except Exception:
                continue  # rate limit / transient — deletion needs proof, not doubt
            if state is None:
                a.status = "stale"
            elif state in ("merged", "closed"):
                a.meta = {**(a.meta or {}), "state": state, "stateType": "completed"}

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None, at=pre.fetched_at)
    await db.commit()
    if stats is not None:
        stats["changed"] = stats.get("changed", 0) + changed
    return ingested


async def _plan_gdrive(db, workspace_id: str) -> _Prefetch:
    try:
        auth = await google_drive.get_auth(db, workspace_id)
    except Exception as exc:
        logger.warning("Google Drive token refresh failed", exc_info=True)
        await _note_sync_health(
            db, await db.get(Integration, {"workspace_id": workspace_id, "key": "google-drive"}), exc
        )
        return _Prefetch()
    if not auth:
        return _Prefetch()
    since, integ = await _sync_plan(db, workspace_id, "google-drive")
    # What's already in memory, so unchanged files are never re-downloaded/re-OCR'd.
    known_rows = (
        await db.execute(
            select(Artifact.external_ref, Artifact.meta).where(
                Artifact.workspace_id == workspace_id, Artifact.source.in_(SOURCE_BY_INTEGRATION["google-drive"])
            )
        )
    ).all()
    known = {ref: (m or {}).get("modifiedAt") for ref, m in known_rows if ref}

    async def fetch():
        return await google_drive.fetch_documents(auth, since=since, known=known)

    return _Prefetch(auth=auth, since=since, integ=integ, fetch=fetch)


async def pull_gdrive(
    db, workspace_id: str, pre: _Prefetch | None = None, *, match_commitments: bool = True, stats: dict | None = None
) -> int:
    """Ingest recently-modified Google Docs/Sheets/Slides + PDFs (text layer,
    scanned ones via OCR) as document artifacts. Content refreshes in place when
    a file changes (modifiedTime moves). Honest when not connected (0) / on failure."""
    if pre is None:
        pre = await _resolve(await _plan_gdrive(db, workspace_id))
    if not pre.auth:
        return 0
    auth, since, integ = pre.auth, pre.since, pre.integ
    if pre.exc is not None:
        logger.warning("Google Drive pull failed", exc_info=pre.exc)
        await _note_sync_health(db, integ, pre.exc)
        return 0
    docs, listed = pre.data

    ingested = 0
    changed = 0
    for d in docs:
        content = d["content"]
        if not content:
            continue
        if d.get("owner"):
            content = f"{content}\n\nOwner: {d['owner']} ({d.get('ownerEmail') or ''})"
        meta = {k: d.get(k) for k in ("owner", "ownerEmail", "modifiedAt", "createdAt")}
        if d.get("ocr"):
            meta["ocr"] = True  # provenance: content came from OCR, not a text layer
        existing = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == d["source"],
                        Artifact.external_ref == d["id"],
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing:
            if meta.get("modifiedAt") and (existing.meta or {}).get("modifiedAt") != meta["modifiedAt"]:
                changed += 1
                existing.content = content
                existing.meta = meta
                existing.occurred_at = _parse_ts(d.get("modifiedAt")) or existing.occurred_at
                # A doc's text actually changed — refresh its opening vector AND its
                # chunks (both fire only on real change, so no per-sync storm).
                if embeddings.available():
                    vec = await embeddings.embed_text(_embed_input(existing.title, content))
                    if vec:
                        existing.embedding = vec
                await _write_chunks(db, existing)
            continue
        await ingest_artifact(
            db,
            workspace_id,
            source=d["source"],
            kind=d["kind"],
            title=d["title"][:300],
            content=content,
            external_ref=d["id"],
            url=d.get("url"),
            occurred_at=_parse_ts(d.get("modifiedAt")),
            meta=meta,
        )
        ingested += 1

    # Reconcile on FULL syncs: files missing from the (capped) listing get a live
    # probe — deleted/trashed → stale; still there → just outside the cap, untouched.
    if since is None:
        rows = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source.in_(SOURCE_BY_INTEGRATION["google-drive"]),
                        Artifact.status != "stale",
                    )
                )
            )
            .scalars()
            .all()
        )
        missing = [a for a in rows if a.external_ref and a.external_ref not in listed]
        random.shuffle(missing)
        for a in missing[:_RECONCILE_CHECKS]:
            try:
                if not await google_drive.file_exists(auth, a.external_ref):
                    a.status = "stale"
            except Exception:
                continue  # transient — deletion needs proof, not doubt

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None, at=pre.fetched_at)
    await db.commit()
    if stats is not None:
        stats["changed"] = stats.get("changed", 0) + changed
    if match_commitments and (ingested or changed):
        from .model import match_open_commitments

        await match_open_commitments(db, workspace_id)
    return ingested


async def _plan_slack(db, workspace_id: str) -> _Prefetch:
    auth = await slack.get_auth(db, workspace_id)
    if not auth:
        return _Prefetch()
    since, integ = await _sync_plan(db, workspace_id, "slack")
    oldest = None
    if since:
        parsed = _parse_ts(since)
        oldest = f"{parsed.timestamp():.6f}" if parsed else None

    async def fetch():
        channels = await slack.list_channels(auth)
        team = await slack.team_url(auth)  # permalink prefix; None degrades to no link
        per_channel = []
        for ch in channels:
            try:
                per_channel.append((ch, await slack.fetch_threads(auth, ch["id"], oldest=oldest)))
            except Exception:
                logger.warning("Slack history failed for #%s", ch.get("name"), exc_info=True)
        return team, per_channel

    return _Prefetch(auth=auth, since=since, integ=integ, fetch=fetch)


async def pull_slack(
    db, workspace_id: str, pre: _Prefetch | None = None, *, match_commitments: bool = True, stats: dict | None = None
) -> int:
    """Ingest Slack threads (root + replies) from the channels the bot is in as
    artifacts. Threads are conversational, so they extract like calls. Honest when
    not connected (0) and on failure (logs, returns what it managed)."""
    if pre is None:
        pre = await _resolve(await _plan_slack(db, workspace_id))
    if not pre.auth:
        return 0
    auth, since, integ = pre.auth, pre.since, pre.integ
    if pre.exc is not None:
        logger.warning("Slack channel list failed", exc_info=pre.exc)
        await _note_sync_health(db, integ, pre.exc)
        return 0
    team, channel_threads = pre.data

    ingested = 0
    changed = 0
    img_budget = _image_budget(integ)
    for ch, threads in channel_threads:
        for t in threads:
            ext = f"{t['channel']}:{t['ts']}"
            url = slack.permalink(team, ch["id"], t["ts"])
            existing = (
                (
                    await db.execute(
                        select(Artifact).where(
                            Artifact.workspace_id == workspace_id,
                            Artifact.source == "slack-message",
                            Artifact.external_ref == ext,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if existing:
                if url and not existing.url:  # backfill deep links on re-sync
                    existing.url = url
                continue
            content = t["text"]
            imgs: dict[str, str] = {}
            for f in (t.get("files") or [])[:5]:
                if img_budget[0] <= 0:
                    break
                img_budget[0] -= 1
                got = await vision.fetch_image(f["url"], auth)
                desc = (await vision.transcribe(*got, name=f["name"]))[:800] if got else ""
                if desc:
                    imgs[f["url"]] = desc
            if imgs:
                content += "\n\nImages:\n" + "\n".join(f"- {d}" for d in imgs.values())
            meta = {"channel": ch["name"], "channelId": ch["id"], "ts": t["ts"], "replyCount": t["reply_count"]}
            if imgs:
                meta["imageTexts"] = imgs
            first_line = (t["text"].split("\n", 1)[0] or "thread").strip()
            await ingest_artifact(
                db,
                workspace_id,
                source="slack-message",
                kind="slack-thread",
                title=f"#{ch['name']}: {first_line}"[:120],
                content=content,
                external_ref=ext,
                url=url,
                occurred_at=_parse_slack_ts(t["ts"]),
                meta=meta,
            )
            ingested += 1

    if since is None and team:
        rows = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == "slack-message",
                        Artifact.url.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        for a in rows:
            m = a.meta or {}
            a.url = slack.permalink(team, m.get("channelId"), m.get("ts")) or a.url

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None, at=pre.fetched_at)
    await db.commit()
    if stats is not None:
        stats["changed"] = stats.get("changed", 0) + changed
    if match_commitments and (ingested or changed):
        from .model import match_open_commitments

        await match_open_commitments(db, workspace_id)
    return ingested


def _fireflies_content_meta(t: dict) -> tuple[str, dict]:
    """Shaped Fireflies transcript → memory text (summary + transcript) + meta.
    A meeting is conversational, so it extracts like a call, not a work item."""
    blocks = [t["title"]]
    if t.get("overview"):
        blocks.append(t["overview"])
    if t.get("actionItems"):
        ai = t["actionItems"]
        blocks.append("Action items:\n" + (ai if isinstance(ai, str) else "\n".join(ai)))
    if t.get("participants"):
        blocks.append("Participants: " + ", ".join(str(p) for p in t["participants"]))
    if t.get("sentences"):
        blocks.append(
            "Transcript:\n"
            + "\n".join(f"{s.get('speaker') or 'someone'}: {s['text']}" for s in t["sentences"] if s.get("text"))
        )
    meta = {
        "identifier": t.get("identifier"),
        "host": t.get("host"),
        "participants": t.get("participants") or [],
        "actionItems": t.get("actionItems") or "",
        "keywords": t.get("keywords") or [],
        "duration": t.get("duration"),
        "date": t.get("date"),
        "url": t.get("url"),
    }
    return "\n\n".join(b for b in blocks if b), meta


async def _plan_fireflies(db, workspace_id: str) -> _Prefetch:
    auth = await fireflies.get_auth(db, workspace_id)
    if not auth:
        return _Prefetch()
    since, integ = await _sync_plan(db, workspace_id, "fireflies")

    async def fetch():
        return await fireflies.fetch_transcripts(auth, since=since)

    return _Prefetch(auth=auth, since=since, integ=integ, fetch=fetch)


async def pull_fireflies(
    db, workspace_id: str, pre: _Prefetch | None = None, *, match_commitments: bool = True, stats: dict | None = None
) -> int:
    """Ingest Fireflies meeting transcripts as call artifacts. Transcripts are
    immutable once written, so existing ones are left untouched (no refresh
    churn). Honest when not connected (0) / on failure."""
    if pre is None:
        pre = await _resolve(await _plan_fireflies(db, workspace_id))
    if not pre.auth:
        return 0
    since, integ = pre.since, pre.integ
    if pre.exc is not None:
        logger.warning("Fireflies pull failed", exc_info=pre.exc)
        await _note_sync_health(db, integ, pre.exc)
        return 0
    transcripts = pre.data

    ingested = 0
    changed = 0
    for t in transcripts:
        ext = t.get("identifier")
        if not ext:
            continue
        existing = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == workspace_id,
                        Artifact.source == "fireflies",
                        Artifact.external_ref == ext,
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing:
            continue
        content, meta = _fireflies_content_meta(t)
        if not content.strip():
            continue
        await ingest_artifact(
            db,
            workspace_id,
            source="fireflies",
            kind="call",
            title=t["title"][:300],
            content=content,
            external_ref=ext,
            url=t.get("url"),
            occurred_at=_parse_epoch_ms(t.get("date")) or _parse_ts(t.get("date")),
            meta=meta,
        )
        ingested += 1

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None, at=pre.fetched_at)
    await db.commit()
    if stats is not None:
        stats["changed"] = stats.get("changed", 0) + changed
    if match_commitments and (ingested or changed):
        from .model import match_open_commitments

        await match_open_commitments(db, workspace_id)
    return ingested


def _circleback_content_meta(payload: dict) -> tuple[str, dict]:
    """Circleback webhook payload → memory text (notes + action items + transcript)
    + meta. Same meeting shape as Fireflies, just delivered by push."""
    name = payload.get("name") or "Meeting"
    blocks = [name]
    if payload.get("notes"):
        blocks.append(payload["notes"])
    items = payload.get("actionItems") or []
    if items:
        lines = []
        for a in items:
            assignee = (a.get("assignee") or {}).get("name") or (a.get("assignee") or {}).get("email")
            line = f"- {a.get('title') or a.get('description') or ''}"
            if assignee:
                line += f" (owner: {assignee})"
            if a.get("status"):
                line += f" [{a['status']}]"
            lines.append(line)
        blocks.append("Action items:\n" + "\n".join(lines))
    attendees = payload.get("attendees") or []
    if attendees:
        blocks.append(
            "Attendees: "
            + ", ".join(a.get("name") or a.get("email") for a in attendees if a.get("name") or a.get("email"))
        )
    transcript = payload.get("transcript") or []
    if transcript:
        blocks.append(
            "Transcript:\n"
            + "\n".join(f"{s.get('speaker') or 'someone'}: {s['text']}" for s in transcript if s.get("text"))
        )
    meta = {
        "identifier": str(payload.get("id") or ""),
        "attendees": attendees,
        "actionItems": items,
        "tags": payload.get("tags") or [],
        "recordingUrl": payload.get("recordingUrl"),
        "createdAt": payload.get("createdAt"),
        "duration": payload.get("duration"),
    }
    return "\n\n".join(b for b in blocks if b), meta


async def ingest_circleback_meeting(db, workspace_id: str, payload: dict) -> Artifact | None:
    """Ingest one Circleback meeting delivered by webhook. Idempotent by meeting
    id, since Circleback may re-deliver. Returns the artifact, or None if empty."""
    ext = str(payload.get("id") or "").strip()
    if not ext:
        return None
    content, meta = _circleback_content_meta(payload)
    if not content.strip():
        return None
    existing = (
        (
            await db.execute(
                select(Artifact).where(
                    Artifact.workspace_id == workspace_id, Artifact.source == "circleback", Artifact.external_ref == ext
                )
            )
        )
        .scalars()
        .first()
    )
    if existing:
        return existing
    return await ingest_artifact(
        db,
        workspace_id,
        source="circleback",
        kind="call",
        title=(payload.get("name") or "Meeting")[:300],
        content=content,
        external_ref=ext,
        url=payload.get("url") or payload.get("recordingUrl"),
        occurred_at=_parse_ts(payload.get("createdAt")),
        meta=meta,
    )


def start_connector_pull(workspace_id: str, key: str) -> None:
    """Webhook-driven targeted sync: pull ONE connector incrementally (the cursor
    fetches only what changed), then run the full reason loop only if something
    actually changed — bot-noise pings cost a single cheap fetch."""
    asyncio.get_event_loop().create_task(_connector_pull_bg(workspace_id, key))


async def _connector_pull_bg(workspace_id: str, key: str) -> None:
    from ..database import SessionLocal

    fn = {"linear": pull_linear, "github": pull_github}.get(key)
    if fn is None:
        return
    try:
        async with SessionLocal() as db:
            stats: dict = {}
            ingested = await fn(db, workspace_id, stats=stats)
        if ingested or stats.get("changed"):
            from .heartbeat import start_sync

            start_sync(workspace_id, f"{key}-webhook")
    except Exception:
        logger.warning("webhook-triggered %s pull failed", key, exc_info=True)


def start_circleback_ingest(workspace_id: str, payload: dict) -> None:
    """Fire-and-forget ingest of a pushed Circleback meeting, so the webhook
    handler returns immediately (safe to call from a request handler)."""
    asyncio.get_event_loop().create_task(_circleback_ingest_bg(workspace_id, payload))


async def _circleback_ingest_bg(workspace_id: str, payload: dict) -> None:
    from ..database import SessionLocal

    try:
        async with SessionLocal() as db:
            await ingest_circleback_meeting(db, workspace_id, payload)
            from .model import match_open_commitments

            await match_open_commitments(db, workspace_id)
    except Exception:
        logger.warning("Circleback ingest failed", exc_info=True)


async def backfill_embeddings(db, workspace_id: str, limit: int = 100) -> int:
    """Embed artifacts that have no vector yet — rows ingested before eager
    embedding, or while AI was off. Runs on the BACKGROUND/heartbeat path (a
    write context), never on a read, so retrieval stays read-only. Bounded per
    call so a big backlog is filled over several ticks. Returns rows embedded.
    """
    if not embeddings.available():
        return 0
    rows = (
        (
            await db.execute(
                select(Artifact).where(Artifact.workspace_id == workspace_id, Artifact.embedding.is_(None)).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0
    vectors = await embeddings.embed_many([_embed_input(a.title, a.content) for a in rows])
    filled = 0
    for a, v in zip(rows, vectors):
        if v:
            a.embedding = v
            filled += 1
    if filled:
        await db.commit()
    return filled


async def backfill_chunks(db, workspace_id: str, limit: int = 50) -> int:
    """Chunk-embed long artifacts that have no chunks yet — rows that predate
    chunking (or were ingested while AI was off). Same background/write context
    and bounded-per-tick contract as backfill_embeddings; converges over ticks.
    Returns how many artifacts were chunked."""
    if not embeddings.available():
        return 0
    chunked = select(ArtifactChunk.artifact_id).where(ArtifactChunk.workspace_id == workspace_id).distinct()
    rows = (
        (
            await db.execute(
                select(Artifact)
                .where(
                    Artifact.workspace_id == workspace_id,
                    func.length(Artifact.content) > _EMBED_WINDOW,
                    Artifact.id.not_in(chunked),
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    done = 0
    for a in rows:
        await _write_chunks(db, a)
        done += 1
    if done:
        await db.commit()
    return done


async def pull_all(db, workspace_id: str) -> dict[str, int]:
    """Pull new artifacts from every connected sensor. Honest per source (0 when
    not connected). This is the Observe step the heartbeat runs.

    Network fetches run CONCURRENTLY (wall clock ≈ the slowest connector);
    everything that writes — upserts, extraction, the entity graph — stays
    serial in this one session, so merge order and semantics are unchanged."""
    connectors = (
        ("linear", _plan_linear, pull_linear),
        ("slack", _plan_slack, pull_slack),
        ("github", _plan_github, pull_github),
        ("google-drive", _plan_gdrive, pull_gdrive),
        ("fireflies", _plan_fireflies, pull_fireflies),
    )
    plans = [await plan(db, workspace_id) for _, plan, _ in connectors]
    resolved = await asyncio.gather(*(_resolve(p) for p in plans))
    stats: dict = {}
    counts = {
        key: await run(db, workspace_id, pre, match_commitments=False, stats=stats)
        for (key, _, run), pre in zip(connectors, resolved)
    }
    if sum(counts.values()) or stats.get("changed"):
        from .model import match_open_commitments

        await match_open_commitments(db, workspace_id)
    return counts
