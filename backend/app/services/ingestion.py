"""Ingestion — the Observe + Remember half of the loop.

One entry point (`ingest_artifact`) writes any observed item into unified memory:
it creates the Artifact, runs the Extractor over it, embeds it for semantic
retrieval, and persists. `pull_linear` is the first sensor: it reads Linear
issues (open + recently completed) and ingests them as artifacts, idempotently.

The legacy Meeting pipeline is untouched; this is the new memory substrate.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from ..agents.extractor import extract
from ..models import Artifact, Integration
from . import embeddings, fireflies, github, google_drive, linear, slack, vision

logger = logging.getLogger("orbit.ingestion")


def _embed_input(title: str, content: str) -> str:
    """The exact text embedded for an artifact — title plus a bounded slice of
    content. Defined once so ingest and backfill embed identically (and match
    what the query side expects)."""
    return f"{title}\n{(content or '')[:2000]}"


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
        stmt = (update(Artifact).where(
            Artifact.workspace_id == workspace_id, Artifact.source.in_(sources),
            Artifact.status != "stale").values(status="stale"))
    else:
        stmt = (update(Artifact).where(
            Artifact.workspace_id == workspace_id, Artifact.source.in_(sources),
            Artifact.status == "stale").values(status="extracted"))
    return (await db.execute(stmt)).rowcount


_FULL_SYNC_EVERY_HOURS = 24
_CURSOR_OVERLAP_MINUTES = 5
_RECONCILE_CHECKS = 50
_INITIAL_BACKFILL_DAYS = 20   

_IMAGE_MD = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)")
_IMAGES_PER_SYNC = 5          # vision reads spend model quota — bounded per pull


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


def _advance_cursor(integ, *, full: bool) -> None:
    if not integ:
        return
    now = datetime.now(timezone.utc)
    st = dict(integ.sync_state or {})
    st["cursor"] = (now - timedelta(minutes=_CURSOR_OVERLAP_MINUTES)).isoformat()
    # The first advance (initial backfill) sets the reconcile baseline too, so the
    # very next tick stays incremental instead of immediately running a full pull.
    if full or not st.get("lastFull"):
        st["lastFull"] = now.isoformat()
    integ.sync_state = st


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


_AUTH_SIGNALS = ("401", "unauthorized", "invalid_auth", "missing_scope",
                 "authentication required", "not authenticated",
                 "token refresh failed", "invalid_grant", "token expired")


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
        existing = (await db.execute(
            select(Artifact).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == source,
                Artifact.external_ref == external_ref,
            )
        )).scalars().first()
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
        discussion = "\n".join(
            f"- {c.get('author') or 'someone'}: {c.get('body')}" for c in comments if c.get("body")
        )
        if discussion:
            blocks.append("Discussion:\n" + discussion)
    content = "\n\n".join(blocks)

    meta = {k: s.get(k) for k in (
        "identifier", "state", "stateType", "createdAt", "updatedAt", "startedAt",
        "completedAt", "dueDate", "assignee", "assigneeEmail", "creator", "team",
        "teamKey", "project", "projectState", "labels", "priority", "priorityLabel",
        "estimate",
    )}
    meta["cycleTimeDays"] = cycle
    meta["comments"] = comments
    meta["commentCount"] = len(comments)
    return content, meta


async def _reembed_if_images_changed(existing, content: str, imgs: dict, prev_imgs: dict) -> None:
    """Re-embed a refreshed artifact ONLY when new image text was folded in, so
    image content becomes semantically searchable. Routine refreshes still never
    re-embed (that would be a storm) — this fires only on the rare tick that
    actually read a new image."""
    if imgs and imgs != prev_imgs and embeddings.available():
        vec = await embeddings.embed_text(_embed_input(existing.title, content))
        if vec:
            existing.embedding = vec


async def pull_linear(db, workspace_id: str) -> int:
    """Ingest Linear issues as full-context artifacts. Returns the count of NEW
    artifacts (existing ones are REFRESHED in place, so a re-pull enriches the
    whole backlog with new fields — owner, project, labels, cycle time).

    Honest when Linear isn't connected (returns 0) and on API failure (logs,
    returns what it managed) — never fabricates.
    """
    auth = await linear.get_auth(db, workspace_id)
    if not auth:
        return 0
    since, integ = await _sync_plan(db, workspace_id, "linear")
    try:
        issues = (await linear.fetch_open_issues(auth, since=since)
                  + await linear.fetch_completed_issues(auth, since=since))
    except Exception as exc:
        logger.warning("Linear pull failed", exc_info=True)
        await _note_sync_health(db, integ, exc)
        return 0

    ingested = 0
    img_budget = [_IMAGES_PER_SYNC]
    for issue in issues:
        content, meta = _linear_content_meta(issue)
        existing = (await db.execute(
            select(Artifact).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == "linear-issue",
                Artifact.external_ref == issue["identifier"],
            )
        )).scalars().first()
        prev_imgs = (existing.meta or {}).get("imageTexts") or {} if existing else {}
        content, imgs = await _fold_images(content, auth=auth, prev=prev_imgs, budget=img_budget)
        if imgs:
            meta["imageTexts"] = imgs
        if existing:
            existing.content = content
            existing.meta = meta
            existing.occurred_at = _parse_ts(issue.get("updatedAt")) or existing.occurred_at
            await _reembed_if_images_changed(existing, content, imgs, prev_imgs)
            # Enrich the ownership graph on every refresh (backfills existing issues).
            from .model import link_work_entities
            await link_work_entities(db, workspace_id, existing)
            # Re-derive facts so reassignments supersede the prior owner.
            from .memory import derive_from_artifact
            await derive_from_artifact(db, workspace_id, existing)
            continue
        await ingest_artifact(
            db, workspace_id,
            source="linear-issue", kind="issue",
            title=f"{issue['identifier']} · {issue['title']}",
            content=content,
            external_ref=issue["identifier"], url=issue.get("url"),
            occurred_at=_parse_ts(issue.get("updatedAt")),
            meta=meta,
        )
        ingested += 1


    if since is None:
        seen = {i["identifier"] for i in issues}
        rows = (await db.execute(select(Artifact).where(
            Artifact.workspace_id == workspace_id, Artifact.source == "linear-issue",
            Artifact.status != "stale"))).scalars().all()
        for a in rows:
            if (a.external_ref and a.external_ref not in seen
                    and (a.meta or {}).get("stateType") not in ("completed", "canceled")):
                a.status = "stale"

    await _note_sync_health(db, integ, None) 
    _advance_cursor(integ, full=since is None)
    await db.commit() 

    # A new issue may fulfill an earlier untracked commitment — re-match once.
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
        facts.append(f"Code: +{s['additions']} / -{s.get('deletions', 0)} across "
                     f"{s.get('changedFiles', '?')} files · {s.get('commits', '?')} commits")
    blocks.append(" · ".join(facts))

    # Reviews + discussion — where blockers and technical decisions live.
    reviews = s.get("reviews") or []
    if reviews:
        blocks.append("Reviews:\n" + "\n".join(
            f"- {r.get('reviewer') or 'someone'} ({r.get('state', '').lower().replace('_', ' ')})"
            + (f": {r['body']}" if r.get("body") else "")
            for r in reviews
        ))
    comments = s.get("comments") or []
    if comments:
        blocks.append("Discussion:\n" + "\n".join(
            f"- {c.get('author') or 'someone'}: {c.get('body')}" for c in comments if c.get("body")
        ))

    meta = {
        "identifier": s.get("identifier"), "state": s.get("state"), "stateType": s.get("stateType"),
        "createdAt": s.get("createdAt"), "updatedAt": s.get("updatedAt"),
        "completedAt": s.get("mergedAt") or s.get("closedAt"),
        "assignee": s.get("assignee"), "creator": s.get("author"),
        "project": s.get("repo"), "labels": s.get("labels") or [], "draft": s.get("draft"),
        "isPr": s.get("isPr"),
        "comments": comments, "commentCount": len(comments),
        "reviews": reviews,
        "additions": s.get("additions"), "deletions": s.get("deletions"),
        "changedFiles": s.get("changedFiles"), "commits": s.get("commits"),
    }
    return "\n\n".join(blocks), meta


async def pull_github(db, workspace_id: str) -> int:
    """Ingest GitHub PRs + issues as artifacts — same idempotent refresh-in-place
    contract as pull_linear. Honest when not connected (0) / on failure."""
    auth = await github.get_auth(db, workspace_id)
    if not auth:
        return 0
    since, integ = await _sync_plan(db, workspace_id, "github")
    try:
        items, contributors = await github.fetch_work(auth, since=since)
    except Exception as exc:
        logger.warning("GitHub pull failed", exc_info=True)
        await _note_sync_health(db, integ, exc)
        return 0

    ingested = 0
    img_budget = [_IMAGES_PER_SYNC]
    for item in items:
        source = "github-pr" if item.get("isPr") else "github-issue"
        content, meta = _github_content_meta(item)
        existing = (await db.execute(
            select(Artifact).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == source,
                Artifact.external_ref == item["identifier"],
            )
        )).scalars().first()
        prev_imgs = (existing.meta or {}).get("imageTexts") or {} if existing else {}
        content, imgs = await _fold_images(content, auth=auth, prev=prev_imgs, budget=img_budget)
        if imgs:
            meta["imageTexts"] = imgs
        if existing:
            existing.content = content
            existing.meta = meta
            existing.occurred_at = _parse_ts(item.get("updatedAt")) or existing.occurred_at
            await _reembed_if_images_changed(existing, content, imgs, prev_imgs)
            from .model import link_work_entities
            await link_work_entities(db, workspace_id, existing)
            from .memory import derive_from_artifact
            await derive_from_artifact(db, workspace_id, existing)
            continue
        await ingest_artifact(
            db, workspace_id,
            source=source, kind="pr" if item.get("isPr") else "issue",
            title=f"{item['identifier']} · {item['title']}"[:300],
            content=content,
            external_ref=item["identifier"], url=item.get("url"),
            occurred_at=_parse_ts(item.get("updatedAt")),
            meta=meta,
        )
        ingested += 1

    # Contributors: every repo's people join the graph (Person -works_on-> repo)
    # and memory learns who actually builds what.
    from .memory import record
    from .model import ensure_link, resolve_entity, resolve_person
    from .model import is_bot
    for repo, people in (contributors or {}).items():
        proj = await resolve_entity(db, workspace_id, "project", repo)
        for p in people:
            if is_bot(p.get("login")):
                continue
            ent = await resolve_person(db, workspace_id, p["login"], handle=p["login"])
            if ent and proj:
                await ensure_link(db, workspace_id, "entity", ent.id, "entity", proj.id, "works_on")
            await record(
                db, workspace_id,
                fact=f"{p['login']} is a contributor to {repo} ({p['contributions']} commits)",
                kind="context", subject=f"contrib:{repo}:{p['login']}",
                source_ref=f"GitHub {repo}", importance=0.4, base_confidence=0.85,
            )

    # Reconcile on FULL syncs: open items missing from the (capped) listing get a
    # live probe — gone → stale; merged/closed outside the window → state fixed;
    # still open → just outside the cap, untouched.
    if since is None:
        seen = {i["identifier"] for i in items}
        rows = (await db.execute(select(Artifact).where(
            Artifact.workspace_id == workspace_id,
            Artifact.source.in_(("github-pr", "github-issue")),
            Artifact.status != "stale"))).scalars().all()
        missing = [a for a in rows
                   if a.external_ref and a.external_ref not in seen
                   and (a.meta or {}).get("stateType") not in ("completed", "canceled")]
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
    _advance_cursor(integ, full=since is None)
    await db.commit()
    return ingested


async def pull_gdrive(db, workspace_id: str) -> int:
    """Ingest recently-modified Google Docs/Sheets/Slides + PDFs (text layer,
    scanned ones via OCR) as document artifacts. Content refreshes in place when
    a file changes (modifiedTime moves). Honest when not connected (0) / on failure."""
    try:
        auth = await google_drive.get_auth(db, workspace_id)
    except Exception as exc:
        logger.warning("Google Drive token refresh failed", exc_info=True)
        await _note_sync_health(db, await db.get(Integration, {"workspace_id": workspace_id, "key": "google-drive"}), exc)
        return 0
    if not auth:
        return 0
    since, integ = await _sync_plan(db, workspace_id, "google-drive")
    # What's already in memory, so unchanged files are never re-downloaded/re-OCR'd.
    known_rows = (await db.execute(select(Artifact.external_ref, Artifact.meta).where(
        Artifact.workspace_id == workspace_id,
        Artifact.source.in_(SOURCE_BY_INTEGRATION["google-drive"])))).all()
    known = {ref: (m or {}).get("modifiedAt") for ref, m in known_rows if ref}
    try:
        docs, listed = await google_drive.fetch_documents(auth, since=since, known=known)
    except Exception as exc:
        logger.warning("Google Drive pull failed", exc_info=True)
        await _note_sync_health(db, integ, exc)
        return 0

    ingested = 0
    for d in docs:
        content = d["content"]
        if not content:
            continue
        if d.get("owner"):
            content = f"{content}\n\nOwner: {d['owner']} ({d.get('ownerEmail') or ''})"
        meta = {k: d.get(k) for k in ("owner", "ownerEmail", "modifiedAt", "createdAt")}
        if d.get("ocr"):
            meta["ocr"] = True  # provenance: content came from OCR, not a text layer
        existing = (await db.execute(
            select(Artifact).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == d["source"],
                Artifact.external_ref == d["id"],
            )
        )).scalars().first()
        if existing:
            if meta.get("modifiedAt") and (existing.meta or {}).get("modifiedAt") != meta["modifiedAt"]:
                existing.content = content
                existing.meta = meta
                existing.occurred_at = _parse_ts(d.get("modifiedAt")) or existing.occurred_at
            continue
        await ingest_artifact(
            db, workspace_id,
            source=d["source"], kind=d["kind"],
            title=d["title"][:300],
            content=content,
            external_ref=d["id"], url=d.get("url"),
            occurred_at=_parse_ts(d.get("modifiedAt")),
            meta=meta,
        )
        ingested += 1

    # Reconcile on FULL syncs: files missing from the (capped) listing get a live
    # probe — deleted/trashed → stale; still there → just outside the cap, untouched.
    if since is None:
        rows = (await db.execute(select(Artifact).where(
            Artifact.workspace_id == workspace_id,
            Artifact.source.in_(SOURCE_BY_INTEGRATION["google-drive"]),
            Artifact.status != "stale"))).scalars().all()
        missing = [a for a in rows if a.external_ref and a.external_ref not in listed]
        random.shuffle(missing)
        for a in missing[:_RECONCILE_CHECKS]:
            try:
                if not await google_drive.file_exists(auth, a.external_ref):
                    a.status = "stale"
            except Exception:
                continue  # transient — deletion needs proof, not doubt

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None)
    await db.commit()
    from .model import match_open_commitments
    await match_open_commitments(db, workspace_id)
    return ingested


async def pull_slack(db, workspace_id: str) -> int:
    """Ingest Slack threads (root + replies) from the channels the bot is in as
    artifacts. Threads are conversational, so they extract like calls. Honest when
    not connected (0) and on failure (logs, returns what it managed)."""
    auth = await slack.get_auth(db, workspace_id)
    if not auth:
        return 0
    since, integ = await _sync_plan(db, workspace_id, "slack")
    try:
        channels = await slack.list_channels(auth)
    except Exception as exc:
        logger.warning("Slack channel list failed", exc_info=True)
        await _note_sync_health(db, integ, exc)
        return 0
    team = await slack.team_url(auth)  # permalink prefix; None degrades to no link
    oldest = None
    if since:
        parsed = _parse_ts(since)
        oldest = f"{parsed.timestamp():.6f}" if parsed else None

    ingested = 0
    img_budget = [_IMAGES_PER_SYNC]
    for ch in channels:
        try:
            threads = await slack.fetch_threads(auth, ch["id"], oldest=oldest)
        except Exception:
            logger.warning("Slack history failed for #%s", ch.get("name"), exc_info=True)
            continue
        for t in threads:
            ext = f"{t['channel']}:{t['ts']}"
            url = slack.permalink(team, ch["id"], t["ts"])
            existing = (await db.execute(select(Artifact).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == "slack-message",
                Artifact.external_ref == ext,
            ))).scalars().first()
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
            meta = {"channel": ch["name"], "channelId": ch["id"],
                    "ts": t["ts"], "replyCount": t["reply_count"]}
            if imgs:
                meta["imageTexts"] = imgs
            first_line = (t["text"].split("\n", 1)[0] or "thread").strip()
            await ingest_artifact(
                db, workspace_id,
                source="slack-message", kind="slack-thread",
                title=f"#{ch['name']}: {first_line}"[:120],
                content=content,
                external_ref=ext, url=url,
                occurred_at=_parse_slack_ts(t["ts"]),
                meta=meta,
            )
            ingested += 1

    if since is None and team:
        rows = (await db.execute(select(Artifact).where(
            Artifact.workspace_id == workspace_id, Artifact.source == "slack-message",
            Artifact.url.is_(None)))).scalars().all()
        for a in rows:
            m = a.meta or {}
            a.url = slack.permalink(team, m.get("channelId"), m.get("ts")) or a.url

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None)
    await db.commit()  

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
        blocks.append("Transcript:\n" + "\n".join(
            f"{s.get('speaker') or 'someone'}: {s['text']}" for s in t["sentences"] if s.get("text")))
    meta = {
        "identifier": t.get("identifier"), "host": t.get("host"),
        "participants": t.get("participants") or [], "actionItems": t.get("actionItems") or "",
        "keywords": t.get("keywords") or [], "duration": t.get("duration"),
        "date": t.get("date"), "url": t.get("url"),
    }
    return "\n\n".join(b for b in blocks if b), meta


async def pull_fireflies(db, workspace_id: str) -> int:
    """Ingest Fireflies meeting transcripts as call artifacts. Transcripts are
    immutable once written, so existing ones are left untouched (no refresh
    churn). Honest when not connected (0) / on failure."""
    auth = await fireflies.get_auth(db, workspace_id)
    if not auth:
        return 0
    since, integ = await _sync_plan(db, workspace_id, "fireflies")
    try:
        transcripts = await fireflies.fetch_transcripts(auth, since=since)
    except Exception as exc:
        logger.warning("Fireflies pull failed", exc_info=True)
        await _note_sync_health(db, integ, exc)
        return 0

    ingested = 0
    for t in transcripts:
        ext = t.get("identifier")
        if not ext:
            continue
        existing = (await db.execute(select(Artifact).where(
            Artifact.workspace_id == workspace_id, Artifact.source == "fireflies",
            Artifact.external_ref == ext))).scalars().first()
        if existing:
            continue
        content, meta = _fireflies_content_meta(t)
        if not content.strip():
            continue
        await ingest_artifact(
            db, workspace_id,
            source="fireflies", kind="call",
            title=t["title"][:300], content=content,
            external_ref=ext, url=t.get("url"),
            occurred_at=_parse_epoch_ms(t.get("date")) or _parse_ts(t.get("date")),
            meta=meta,
        )
        ingested += 1

    await _note_sync_health(db, integ, None)  # a clean pull clears any prior 'reconnect'
    _advance_cursor(integ, full=since is None)
    await db.commit()
    # A meeting can create a commitment; re-match against Linear.
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
        blocks.append("Attendees: " + ", ".join(
            a.get("name") or a.get("email") for a in attendees if a.get("name") or a.get("email")))
    transcript = payload.get("transcript") or []
    if transcript:
        blocks.append("Transcript:\n" + "\n".join(
            f"{s.get('speaker') or 'someone'}: {s['text']}" for s in transcript if s.get("text")))
    meta = {
        "identifier": str(payload.get("id") or ""), "attendees": attendees,
        "actionItems": items, "tags": payload.get("tags") or [],
        "recordingUrl": payload.get("recordingUrl"), "createdAt": payload.get("createdAt"),
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
    existing = (await db.execute(select(Artifact).where(
        Artifact.workspace_id == workspace_id, Artifact.source == "circleback",
        Artifact.external_ref == ext))).scalars().first()
    if existing:
        return existing
    return await ingest_artifact(
        db, workspace_id,
        source="circleback", kind="call",
        title=(payload.get("name") or "Meeting")[:300], content=content,
        external_ref=ext, url=payload.get("url") or payload.get("recordingUrl"),
        occurred_at=_parse_ts(payload.get("createdAt")),
        meta=meta,
    )


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
    rows = (await db.execute(
        select(Artifact).where(
            Artifact.workspace_id == workspace_id, Artifact.embedding.is_(None)
        ).limit(limit)
    )).scalars().all()
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


async def pull_all(db, workspace_id: str) -> dict[str, int]:
    """Pull new artifacts from every connected sensor. Honest per source (0 when
    not connected). This is the Observe step the heartbeat runs."""
    return {
        "linear": await pull_linear(db, workspace_id),
        "slack": await pull_slack(db, workspace_id),
        "github": await pull_github(db, workspace_id),
        "google-drive": await pull_gdrive(db, workspace_id),
        "fireflies": await pull_fireflies(db, workspace_id),
    }
