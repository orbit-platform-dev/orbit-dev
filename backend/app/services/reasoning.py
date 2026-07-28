from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..config import settings
from ..models import Artifact, Entity, Insight, Link
from .learning import render_corrections
from .model import WORK_SOURCES, text_match

logger = logging.getLogger("orbit.reasoning")

_UNREQUESTED_THRESHOLD = 3
_STALE_PR_DAYS = 7
_MCP_GAP_REPEATS = 2
_MCP_GAP_WINDOW_DAYS = 14


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clip(s: str, n: int = 140) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


async def _load(db, ws: str):
    ents = (await db.execute(select(Entity).where(Entity.workspace_id == ws))).scalars().all()
    links = (await db.execute(select(Link).where(Link.workspace_id == ws))).scalars().all()
    arts = (await db.execute(select(Artifact).where(Artifact.workspace_id == ws))).scalars().all()
    return ents, links, arts


def issue_from_commitment(c: Entity, source_title: str | None) -> dict:
    """The prepared Linear write for an untracked commitment (the recommendation)."""
    meta = c.meta or {}
    parts = [c.name]
    if meta.get("to"):
        parts.append(f"Committed to {meta['to']}.")
    if meta.get("due"):
        parts.append(f"Due: {meta['due']}.")
    if source_title:
        parts.append(f"Source: {source_title}.")
    parts.append("Created from an Orbit finding.")
    return {
        "type": "create-linear-issue",
        "target": "linear",
        "title": _clip(c.name, 120),
        "description": "\n\n".join(parts),
    }


async def detect_findings(db, ws: str) -> int:
    """Run the detectors, upsert findings (dedup by key), resolve stale ones.
    Returns the number of currently-open findings. Advances commitment state to
    'delivered' when its Linear issue has completed (the outcome watcher)."""
    ents, links, arts = await _load(db, ws)
    by_id = {e.id: e for e in ents}
    arts_by_id = {a.id: a for a in arts}
    commitments = [e for e in ents if e.kind == "commitment"]
    features = [e for e in ents if e.kind == "feature"]

    fulfilling_artifact: dict[str, str] = {}  # commitment_id -> artifact_id (Linear issue)
    source_artifact: dict[str, str] = {}  # commitment_id -> artifact_id (the call)
    requested_customers: dict[str, set[str]] = {}  # feature_id -> {customer_id}
    for lk in links:
        if lk.type == "fulfills" and lk.to_type == "entity":
            fulfilling_artifact[lk.to_id] = lk.from_id
        elif lk.type == "source_of" and lk.to_type == "entity":
            source_artifact.setdefault(lk.to_id, lk.from_id)
        elif lk.type == "requested_by" and lk.from_type == "entity" and lk.to_type == "entity":
            requested_customers.setdefault(lk.from_id, set()).add(lk.to_id)

    linear_arts = [a for a in arts if a.source == "linear-issue"]
    work_arts = [a for a in arts if a.source in WORK_SOURCES]
    feature_names = [f.name for f in features]
    desired: list[dict] = []

    for c in commitments:
        if c.state != "open":
            continue
        src = arts_by_id.get(source_artifact.get(c.id, ""))
        detail = c.name
        if (c.meta or {}).get("to"):
            detail += f" · committed to {c.meta['to']}"
        if (c.meta or {}).get("due"):
            detail += f" · due {c.meta['due']}"
        detail += ". No tracked work covers this yet."
        desired.append(
            {
                "dedupe_key": f"untracked:{c.id}",
                "kind": "gap",
                "title": f"Promised but not tracked: {_clip(c.name, 80)}",
                "detail": detail,
                "entity_ids": [c.id],
                "artifact_ids": [src.id] if src else [],
                "action": issue_from_commitment(c, src.title if src else None),
            }
        )

    for c in commitments:
        if c.state not in ("tracked", "delivered"):
            continue
        ref = (c.meta or {}).get("work") or (c.meta or {}).get("linear") or {}
        ident = ref.get("identifier")
        done = next(
            (
                a
                for a in work_arts
                if (a.meta or {}).get("stateType") == "completed"
                and ((a.meta or {}).get("identifier") or a.external_ref) == ident
            ),
            None,
        )
        if not done:
            continue
        if c.state != "delivered":
            c.state = "delivered"
            c.updated_at = _now()
        desired.append(
            {
                "dedupe_key": f"win:{c.id}",
                "kind": "win",
                "title": f"Delivered: {_clip(c.name, 80)}",
                "detail": f"{done.title} is complete — the commitment is delivered. Consider telling the customer.",
                "entity_ids": [c.id],
                "artifact_ids": [done.id],
                "action": None,
            }
        )

    for f in features:
        custs = requested_customers.get(f.id, set())
        if len(custs) >= 2:
            names = [by_id[cid].name for cid in custs if cid in by_id]
            desired.append(
                {
                    "dedupe_key": f"demand:{f.id}",
                    "kind": "trend",
                    "title": f"{len(custs)} customers asked for: {_clip(f.name, 70)}",
                    "detail": "Requested by " + ", ".join(names) + ".",
                    "entity_ids": [f.id, *custs],
                    "artifact_ids": [],
                    "action": None,
                }
            )

    # 4) Unrequested in-progress work -> drift (aggregate, only when it's a cluster)
    tracked_ids = set(fulfilling_artifact.values())
    unlinked = [
        a
        for a in linear_arts
        if (a.meta or {}).get("stateType") != "completed"
        and a.id not in tracked_ids
        and not any(text_match(a.title, fn) for fn in feature_names)
    ]
    if len(unlinked) >= _UNREQUESTED_THRESHOLD:
        examples = ", ".join(a.external_ref or a.title for a in unlinked[:4])
        desired.append(
            {
                "dedupe_key": "unrequested-work",
                "kind": "drift",
                "title": f"{len(unlinked)} in-progress items aren't tied to a customer request",
                "detail": f"Open work with no matching commitment or request: {examples}.",
                "entity_ids": [],
                "artifact_ids": [a.id for a in unlinked[:8]],
                "action": None,
            }
        )

    now = _now()
    stale_prs = []
    for a in arts:
        m = a.meta or {}
        if a.source != "github-pr" or m.get("stateType") in ("completed", "canceled") or m.get("draft"):
            continue
        occurred = a.occurred_at
        if occurred and occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        if occurred and (now - occurred).days >= _STALE_PR_DAYS:
            stale_prs.append(a)
    if stale_prs:
        examples = ", ".join(f"{a.external_ref} ({(a.meta or {}).get('creator') or 'unknown'})" for a in stale_prs[:4])
        desired.append(
            {
                "dedupe_key": "stale-prs",
                "kind": "drift",
                "title": f"{len(stale_prs)} pull requests have sat open for {_STALE_PR_DAYS}+ days",
                "detail": f"Unmerged code is undelivered work and a review bottleneck: {examples}.",
                "entity_ids": [],
                "artifact_ids": [a.id for a in stale_prs[:8]],
                "action": None,
            }
        )

    # 6) INFERENCE: blocked work propagates to its project.
    #    active blocker fact (PR/issue) → the artifact → its project.
    from ..models import Memory

    blockers = (
        (
            await db.execute(
                select(Memory).where(Memory.workspace_id == ws, Memory.kind == "blocker", Memory.status == "active")
            )
        )
        .scalars()
        .all()
    )
    ident_art = {(a.external_ref or "").lower(): a for a in arts if a.external_ref}
    by_project: dict[str, list] = {}
    for b in blockers:
        art = ident_art.get((b.subject or "").lower())
        proj = (art.meta or {}).get("project") if art else None
        if art and proj and (art.meta or {}).get("stateType") not in ("completed", "canceled"):
            by_project.setdefault(proj, []).append(art)
    for proj, blocked_arts in by_project.items():
        idents = ", ".join(a.external_ref or a.title for a in blocked_arts[:4])
        desired.append(
            {
                "dedupe_key": f"blocked-project:{proj}",
                "kind": "drift",
                "title": f"{proj} has blocked work",
                "detail": f"Waiting on review changes: {idents}. Blocked work stalls everything downstream of it.",
                "entity_ids": [],
                "artifact_ids": [a.id for a in blocked_arts[:8]],
                "action": None,
            }
        )

    blocked_idents = {(b.subject or "").lower() for b in blockers}
    stall_cutoff = _now() - timedelta(days=14)
    for c in commitments:
        if c.state != "tracked":
            continue
        ident = ((c.meta or {}).get("work") or (c.meta or {}).get("linear") or {}).get("identifier") or ""
        art = ident_art.get(ident.lower())
        if not art or (art.meta or {}).get("stateType") in ("completed", "canceled"):
            continue
        occurred = art.occurred_at
        if occurred and occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        blocked = ident.lower() in blocked_idents
        stalled = occurred is not None and occurred < stall_cutoff
        if not (blocked or stalled):
            continue
        cust_id = next((lk.to_id for lk in links if lk.type == "made_to" and lk.from_id == c.id), None)
        cust = by_id.get(cust_id) if cust_id else None
        why = "its work is blocked in review" if blocked else f"{ident} hasn't moved in 14+ days"
        desired.append(
            {
                "dedupe_key": f"commit-risk:{c.id}",
                "kind": "drift",
                "title": f"Commitment{' to ' + cust.name if cust else ''} may slip: {_clip(c.name, 60)}",
                "detail": f"Tracked as {ident}, but {why}.",
                "entity_ids": [c.id] + ([cust.id] if cust else []),
                "artifact_ids": [art.id],
                "action": None,
            }
        )

    # 8) OBSERVE the observers: questions external agents asked over MCP that
    #    memory could not answer are a mapped knowledge gap — repeated ⇒ surface.
    from ..agents.orbit_agent import _STOPWORDS, _toks
    from ..models import McpQuery

    window_start = _now() - timedelta(days=_MCP_GAP_WINDOW_DAYS)
    misses = (await db.execute(select(McpQuery).where(McpQuery.workspace_id == ws, McpQuery.hits == 0))).scalars().all()
    by_question: dict[str, list[McpQuery]] = {}
    for q in misses:
        at = q.created_at
        if at and at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        toks = sorted(_toks(q.query) - _STOPWORDS)
        if not toks or not at or at < window_start:
            continue
        by_question.setdefault(" ".join(toks), []).append(q)
    for key, qs in by_question.items():
        if len(qs) < _MCP_GAP_REPEATS:
            continue
        latest = max(qs, key=lambda q: q.created_at)
        desired.append(
            {
                "dedupe_key": f"mcp-gap:{hashlib.md5(key.encode()).hexdigest()[:12]}",
                "kind": "gap",
                "title": f'Agents keep asking: "{_clip(latest.query, 70)}" — memory has no answer',
                "detail": (
                    f"Asked {len(qs)} times over MCP in the last {_MCP_GAP_WINDOW_DAYS} days "
                    "with zero matching memory. Connect the tool or add the call/document "
                    "that answers it."
                ),
                "entity_ids": [],
                "artifact_ids": [],
                "action": None,
            }
        )

    corrections = await render_corrections(db, ws)
    await _upsert(db, ws, desired, corrections)
    open_count = (
        (
            await db.execute(
                select(Insight).where(Insight.workspace_id == ws, Insight.origin == "model", Insight.status == "open")
            )
        )
        .scalars()
        .all()
    )
    return len(open_count)


async def _draft_action(base_action: dict, corrections: str) -> dict:
    """Learning: draft the recommendation's Linear issue in the team's style
    using recent corrections. Deterministic fallback with AI off or on failure."""
    if not settings.ai_enabled or base_action.get("type") != "create-linear-issue":
        return base_action
    try:
        from ..agents.definitions import SYSTEM_PROMPTS, build_agent
        from ..agents.schemas import DraftedIssue

        agent = build_agent(SYSTEM_PROMPTS["issue-writer"], DraftedIssue)
        prompt = (
            f"{corrections}\n\nDraft title: {base_action.get('title', '')}\n"
            f"Draft description: {base_action.get('description', '')}"
        )
        out = (await agent.run(prompt)).output
        return {
            **base_action,
            "title": (out.title or base_action.get("title", ""))[:120],
            "description": out.description or base_action.get("description", ""),
        }
    except Exception:
        logger.warning("issue drafting failed; using deterministic action", exc_info=True)
        return base_action


async def _upsert(db, ws: str, desired: list[dict], corrections: str = "") -> None:
    """Create/update open findings by dedupe_key; resolve open ones that no longer
    hold. Learning: findings the user dismissed or already approved never resurface,
    and a human-edited action is preserved across scans."""
    existing = (
        (
            await db.execute(
                select(Insight).where(
                    Insight.workspace_id == ws,
                    Insight.origin == "model",
                    Insight.kind.notin_(("brief", "note")),
                    Insight.status.in_(("open", "dismissed", "approved")),
                )
            )
        )
        .scalars()
        .all()
    )
    by_open = {i.dedupe_key: i for i in existing if i.dedupe_key and i.status == "open"}
    blocked = {i.dedupe_key for i in existing if i.dedupe_key and i.status in ("dismissed", "approved")}
    desired_keys = {d["dedupe_key"] for d in desired}

    for d in desired:
        if d["dedupe_key"] in blocked:  # respect the human's dismissal / prior approval
            continue
        cur = by_open.get(d["dedupe_key"])
        if cur:
            cur.kind, cur.title, cur.detail = d["kind"], d["title"], d["detail"]
            cur.entity_ids, cur.artifact_ids = d["entity_ids"], d["artifact_ids"]
            if not cur.action and d["action"]:  # keep a human-edited action; only fill if empty
                cur.action = d["action"]
        else:
            action = await _draft_action(d["action"], corrections) if d["action"] else None
            db.add(
                Insight(
                    id=f"in_{uuid.uuid4().hex[:10]}",
                    workspace_id=ws,
                    origin="model",
                    kind=d["kind"],
                    title=d["title"][:200],
                    detail=d["detail"],
                    entity_ids=d["entity_ids"],
                    artifact_ids=d["artifact_ids"],
                    action=action,
                    dedupe_key=d["dedupe_key"],
                    evidence={},
                    status="open",
                    created_at=_now(),
                )
            )
    for key, cur in by_open.items():
        if key not in desired_keys:
            cur.status = "resolved"
    await db.commit()


def _fallback_brief(open_findings: list[Insight]) -> dict:
    by_kind: dict[str, int] = {}
    for f in open_findings:
        by_kind[f.kind] = by_kind.get(f.kind, 0) + 1
    gaps = by_kind.get("gap", 0)
    headline = f"{len(open_findings)} things need attention" if open_findings else "Everything tracked is on course"
    summary = (
        f"{gaps} commitment(s) have no tracked work, "
        f"{by_kind.get('trend', 0)} repeated request(s), "
        f"{by_kind.get('drift', 0)} drift signal(s), "
        f"{by_kind.get('win', 0)} delivered."
    )
    return {
        "headline": headline,
        "summary": summary,
        "risks": [f.title for f in open_findings if f.kind in ("gap", "drift")][:5],
        "highlights": [f.title for f in open_findings if f.kind == "win"][:5],
        "recommendations": [f.title for f in open_findings if f.kind == "gap"][:5],
    }


async def generate_brief(db, ws: str) -> Insight:
    """Reasoner: a short, evidence-grounded narrative over the current findings.
    Uses the LLM when available, a deterministic template otherwise.

    Change-gated: the brief narrates the open findings, so if that set hasn't
    changed since the last brief (and it isn't stale), regenerating is a pure
    waste of an LLM call — every webhook sync lands here."""
    open_findings = (
        (
            await db.execute(
                select(Insight)
                .where(Insight.workspace_id == ws, Insight.origin == "model", Insight.status == "open")
                .order_by(Insight.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    fingerprint = hashlib.sha1("|".join(sorted(f.id for f in open_findings if f.kind != "brief")).encode()).hexdigest()[
        :16
    ]
    existing = (
        (
            await db.execute(
                select(Insight).where(
                    Insight.workspace_id == ws, Insight.origin == "model", Insight.dedupe_key == "brief"
                )
            )
        )
        .scalars()
        .first()
    )
    if existing and (existing.evidence or {}).get("fingerprint") == fingerprint:
        age = _now() - (
            existing.created_at.replace(tzinfo=timezone.utc)
            if existing.created_at.tzinfo is None
            else existing.created_at
        )
        if age < timedelta(days=settings.brief_max_age_days):
            return existing

    data = _fallback_brief(open_findings)
    if settings.ai_enabled:
        try:
            from ..agents.definitions import SYSTEM_PROMPTS, build_agent
            from ..agents.schemas import IntelligenceBrief

            corrections = await render_corrections(db, ws)
            findings_block = "CURRENT FINDINGS:\n" + "\n".join(f"- [{f.kind}] {f.title}" for f in open_findings)
            context = f"{corrections}\n\n{findings_block}" if corrections else findings_block
            agent = build_agent(SYSTEM_PROMPTS["intelligence-brief"], IntelligenceBrief)
            data = (await agent.run(context or "No open findings.")).output.model_dump(by_alias=True)
        except Exception:
            logger.warning("reasoner brief failed; using fallback", exc_info=True)

    brief = existing
    if not brief:
        brief = Insight(
            id=f"in_{uuid.uuid4().hex[:10]}",
            workspace_id=ws,
            origin="model",
            kind="brief",
            dedupe_key="brief",
            status="open",
            created_at=_now(),
        )
        db.add(brief)
    brief.status = "open"  # a regenerated brief is current again (undo any prior resolve)
    brief.title = data.get("headline", "")[:200]
    brief.detail = data.get("summary", "")
    brief.evidence = {k: data.get(k, []) for k in ("risks", "highlights", "recommendations")} | {
        "fingerprint": fingerprint
    }
    brief.created_at = _now()
    await db.commit()
    return brief
