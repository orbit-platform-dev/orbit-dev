"""Ingestion — the Observe + Remember half of the loop.

One entry point (`ingest_artifact`) writes any observed item into unified memory:
it creates the Artifact, runs the Extractor over it, embeds it for semantic
retrieval, and persists. `pull_linear` is the first sensor: it reads Linear
issues (open + recently completed) and ingests them as artifacts, idempotently.

The legacy Meeting pipeline is untouched; this is the new memory substrate.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..agents.extractor import extract
from ..models import Artifact
from . import linear, slack

logger = logging.getLogger("orbit.ingestion")

# Which artifact source(s) each connector produces. Used to mark a connector's
# memory stale on disconnect (memory is kept as history, never silently deleted).
SOURCE_BY_INTEGRATION: dict[str, list[str]] = {
    "linear": ["linear-issue"],
    "slack": ["slack-message"],
    "github": ["github-pr", "github-issue"],
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
    # No embedding on ingest. Vectors are computed lazily during matching (only
    # when something actually reads them), keeping syncs fast and cheap.

    await db.commit()
    await db.refresh(art)

    # Understand: fold this artifact into the company model (entities + links).
    from .model import build_from_artifact
    await build_from_artifact(db, workspace_id, art)
    return art


async def pull_linear(db, workspace_id: str) -> int:
    """Ingest Linear issues as artifacts. Returns the count of NEW artifacts.

    Honest when Linear isn't connected (returns 0) and on API failure (logs,
    returns what it managed) — never fabricates.
    """
    auth = await linear.get_auth(db, workspace_id)
    if not auth:
        return 0
    try:
        issues = await linear.fetch_open_issues(auth) + await linear.fetch_completed_issues(auth)
    except Exception:
        logger.warning("Linear pull failed", exc_info=True)
        return 0

    ingested = 0
    for issue in issues:
        before = (await db.execute(
            select(Artifact.id).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == "linear-issue",
                Artifact.external_ref == issue["identifier"],
            )
        )).first()
        if before:
            continue
        # Read the whole ticket, not just the title: description is the substance
        # the comparator and drift detection reason over.
        desc = (issue.get("description") or "").strip()
        content = issue["title"]
        if desc:
            content += f"\n\n{desc}"
        content += f"\n\n(Linear {issue['identifier']} · state: {issue.get('state', '')})"
        await ingest_artifact(
            db, workspace_id,
            source="linear-issue", kind="issue",
            title=f"{issue['identifier']} · {issue['title']}",
            content=content,
            external_ref=issue["identifier"], url=issue.get("url"),
            occurred_at=_parse_ts(issue.get("updatedAt")),
            meta={
                "identifier": issue["identifier"],
                "state": issue.get("state", ""),
                "stateType": issue.get("stateType", ""),
                "updatedAt": issue.get("updatedAt", ""),
            },
        )
        ingested += 1

    # A new issue may fulfill an earlier untracked commitment — re-match once.
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
    try:
        channels = await slack.list_channels(auth)
    except Exception:
        logger.warning("Slack channel list failed", exc_info=True)
        return 0

    ingested = 0
    for ch in channels:
        try:
            threads = await slack.fetch_threads(auth, ch["id"])
        except Exception:
            logger.warning("Slack history failed for #%s", ch.get("name"), exc_info=True)
            continue
        for t in threads:
            ext = f"{t['channel']}:{t['ts']}"
            exists = (await db.execute(select(Artifact.id).where(
                Artifact.workspace_id == workspace_id,
                Artifact.source == "slack-message",
                Artifact.external_ref == ext,
            ))).first()
            if exists:
                continue
            first_line = (t["text"].split("\n", 1)[0] or "thread").strip()
            await ingest_artifact(
                db, workspace_id,
                source="slack-message", kind="slack-thread",
                title=f"#{ch['name']}: {first_line}"[:120],
                content=t["text"],
                external_ref=ext, url=None,
                occurred_at=_parse_slack_ts(t["ts"]),
                meta={"channel": ch["name"], "channelId": ch["id"],
                      "ts": t["ts"], "replyCount": t["reply_count"]},
            )
            ingested += 1

    # A Slack thread can create a commitment; re-match against Linear.
    from .model import match_open_commitments
    await match_open_commitments(db, workspace_id)
    return ingested


async def pull_all(db, workspace_id: str) -> dict[str, int]:
    """Pull new artifacts from every connected sensor. Honest per source (0 when
    not connected). This is the Observe step the heartbeat runs."""
    return {
        "linear": await pull_linear(db, workspace_id),
        "slack": await pull_slack(db, workspace_id),
    }
