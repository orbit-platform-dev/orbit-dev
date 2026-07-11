"""Gap detection — the comparator between intention and reality.

Deterministic rules over data Orbit already trusts (approved knowledge, goals,
proposals, and — when Linear is connected — live execution state). No LLM
decides a fact: matching uses embeddings/token overlap, but every insight is
verifiable from its evidence, which is what makes it safe to act on. The LLM
writes the brief, not the facts.

kinds: risk (something threatens a promise or goal) · gap (intention with no
matching execution) · trend (the same theme keeps coming back, per customer or
across customers) · win (a promise was delivered — close the loop, tell the
customer) · brief (the generated narrative).
"""
from __future__ import annotations

import difflib
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select

from ..models import Customer, ExecutionPlan, Goal, Insight, KnowledgeItem
from . import embeddings, linear
from .customers import normalize_name

logger = logging.getLogger("orbit.insights")

_COMMITMENT_AGING_DAYS = 7
_PROPOSAL_STALL_DAYS = 5
_ISSUE_STALE_DAYS = 7
_GOAL_LOOKAHEAD_DAYS = 21
_SEMANTIC_THRESHOLD = 0.75  # doc-doc cosine on short titles; below this, not the same thing
_FUZZY_THRESHOLD = 0.85

# Per-scan embedding cache: short titles repeat across detectors and ticks.
_vec_cache: dict[str, list[float] | None] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt and dt.tzinfo is None:  # SQLite drops tzinfo
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _insight(ws: str, kind: str, title: str, detail: str, evidence: dict,
             customer_id: str | None = None) -> Insight:
    return Insight(id=f"in_{uuid.uuid4().hex[:8]}", workspace_id=ws, customer_id=customer_id,
                   kind=kind, title=title[:140], detail=detail, evidence=evidence,
                   status="open", created_at=_now())


def _tokens(text: str) -> set[str]:
    return {w for w in normalize_name(text).split() if len(w) > 3}


async def _vec(text: str) -> list[float] | None:
    key = normalize_name(text)[:200]
    if key not in _vec_cache:
        if len(_vec_cache) > 500:
            _vec_cache.clear()
        _vec_cache[key] = await embeddings.embed_text(text, task="SEMANTIC_SIMILARITY")
    return _vec_cache[key]


async def _similar(a: str, b: str) -> bool:
    """Do two short texts mean the same thing? Token overlap catches shared
    wording; difflib catches typos; embeddings catch paraphrase ("SSO" vs
    "log in with Okta"). Cheap checks first, API call last."""
    ta, tb = _tokens(a), _tokens(b)
    if len(ta & tb) >= 2 or (ta and ta == tb):
        return True
    if difflib.SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio() >= _FUZZY_THRESHOLD:
        return True
    if embeddings.available():
        va, vb = await _vec(a), await _vec(b)
        if va and vb and embeddings.cosine(va, vb) >= _SEMANTIC_THRESHOLD:
            return True
    return False


async def _best_issue_match(text: str, issues: list[dict]) -> dict | None:
    for issue in issues:
        if await _similar(text, issue["title"]):
            return issue
    return None


async def detect_insights(db, ws: str) -> list[Insight]:
    """Run every detector; skip anything that already has an open insight with
    the same title (re-scanning is idempotent, not spammy)."""
    existing = {i.title for i in (await db.execute(
        select(Insight).where(Insight.workspace_id == ws, Insight.status == "open"))).scalars().all()}
    customers = {c.id: c for c in (await db.execute(
        select(Customer).where(Customer.workspace_id == ws))).scalars().all()}
    found: list[Insight] = []

    def add(ins: Insight) -> None:
        if ins.title not in existing:
            existing.add(ins.title)
            found.append(ins)

    def who(customer_id: str | None) -> str:
        c = customers.get(customer_id)
        return c.name if c else "a customer"

    # ── 1. Aging commitments: promises without visible progress ─────────────
    commitments = (await db.execute(select(KnowledgeItem).where(
        KnowledgeItem.workspace_id == ws, KnowledgeItem.kind == "commitment",
        KnowledgeItem.status == "open"))).scalars().all()
    for k in commitments:
        age = (_now() - _aware(k.created_at)).days if k.created_at else 0
        if age >= _COMMITMENT_AGING_DAYS:
            add(_insight(ws, "risk",
                         f"Commitment aging {age}d: {k.title}",
                         f"Promised to {who(k.customer_id)} {age} days ago and still open.",
                         {"commitmentId": k.id, "ageDays": age}, k.customer_id))

    # ── 2. Repeating themes — per customer AND across customers ─────────────
    # Themes are clustered by meaning, so "SSO", "single sign-on" and "log in
    # with Okta" count as one demand, not three.
    raw: list[tuple[str | None, str, str | None]] = []  # (customer_id, theme, meeting_id)
    summaries = (await db.execute(select(KnowledgeItem).where(
        KnowledgeItem.workspace_id == ws, KnowledgeItem.kind == "meeting-summary"))).scalars().all()
    for k in summaries:
        for theme in (k.content or {}).get("featureRequests", []) + (k.content or {}).get("painPoints", []):
            t = str(theme).strip()
            if t:
                raw.append((k.customer_id, t, k.source_meeting_id))

    clusters: list[dict] = []  # {label, hits: [(customer_id, meeting_id)]}
    for customer_id, theme, meeting_id in raw:
        target = None
        for c in clusters:
            if await _similar(theme, c["label"]):
                target = c
                break
        if target is None:
            target = {"label": theme, "hits": []}
            clusters.append(target)
        if (customer_id, meeting_id) not in target["hits"]:
            target["hits"].append((customer_id, meeting_id))

    for c in clusters:
        by_customer: dict[str | None, list[str]] = defaultdict(list)
        for customer_id, meeting_id in c["hits"]:
            if meeting_id not in by_customer[customer_id]:
                by_customer[customer_id].append(meeting_id)
        # Same customer keeps raising it.
        for customer_id, meetings in by_customer.items():
            if len(meetings) >= 2:
                add(_insight(ws, "trend",
                             f"Raised {len(meetings)}x: {c['label']}",
                             f"{who(customer_id)} has raised this in {len(meetings)} separate meetings.",
                             {"meetingIds": meetings, "theme": c["label"]}, customer_id))
        # Different customers want the same thing — company-level demand.
        distinct = [cid for cid in by_customer if cid]
        if len(distinct) >= 2:
            names = [who(cid) for cid in distinct]
            add(_insight(ws, "trend",
                         f"{len(distinct)} customers want: {c['label']}",
                         f"Raised independently by {', '.join(names)}. Demand signal, not a one-off.",
                         {"customers": names, "theme": c["label"],
                          "meetingIds": [m for _, m in c["hits"] if m]}))

    # ── 3. Stalled proposals: drafted, then nobody decided ──────────────────
    drafts = (await db.execute(select(ExecutionPlan).where(
        ExecutionPlan.workspace_id == ws, ExecutionPlan.approval_status == "draft"))).scalars().all()
    for p in drafts:
        age = (_now() - _aware(p.start_date)).days if p.start_date else 0
        if age >= _PROPOSAL_STALL_DAYS:
            add(_insight(ws, "gap",
                         f"Proposal unreviewed {age}d: {p.name}",
                         "Drafted and waiting for review — no approve or reject decision has been made.",
                         {"planId": p.id, "ageDays": age}, p.customer_id))

    # ── 4. Commitments vs Linear: the reality check + loop closure ──────────
    api_key = await linear.get_api_key(db)
    if api_key and commitments:
        try:
            open_issues = await linear.fetch_open_issues(api_key)
            done_issues = await linear.fetch_completed_issues(api_key)
            for k in commitments:
                # Loop closure: the promised work shipped. Orbit updates its own
                # memory to match reality and surfaces the win — telling the
                # customer stays a human act.
                done = await _best_issue_match(k.title, done_issues)
                if done is not None:
                    k.status = "completed"
                    add(_insight(ws, "win",
                                 f"Delivered: {k.title}",
                                 f"{done['identifier']} is {done['state']} — the commitment to "
                                 f"{who(k.customer_id)} is marked completed. Tell them.",
                                 {"commitmentId": k.id, "issue": done}, k.customer_id))
                    continue
                match = await _best_issue_match(k.title, open_issues)
                if match is None:
                    add(_insight(ws, "gap",
                                 f"No tracked work for: {k.title}",
                                 f"This commitment to {who(k.customer_id)} has no matching Linear issue.",
                                 {"commitmentId": k.id}, k.customer_id))
                else:
                    updated = datetime.fromisoformat(match["updatedAt"].replace("Z", "+00:00"))
                    stale = (_now() - updated).days
                    if stale >= _ISSUE_STALE_DAYS:
                        add(_insight(ws, "risk",
                                     f"Work stalled {stale}d: {match['identifier']} {match['title']}",
                                     f"Linked to the commitment \"{k.title}\" but hasn't moved in {stale} days ({match['state']}).",
                                     {"commitmentId": k.id, "issue": match, "staleDays": stale}, k.customer_id))
        except Exception as exc:
            logger.warning("Linear comparator skipped: %s", exc)

    # ── 5. Goal drift: declared intentions vs what's actually happening ─────
    goals = (await db.execute(select(Goal).where(
        Goal.workspace_id == ws, Goal.status == "open"))).scalars().all()
    if goals:
        issues: list[dict] = []
        if api_key:
            try:
                issues = await linear.fetch_open_issues(api_key)
            except Exception:
                pass
        plans = (await db.execute(select(ExecutionPlan).where(
            ExecutionPlan.workspace_id == ws))).scalars().all()
        for g in goals:
            goal_text = f"{g.title} {g.detail}".strip()
            target = _aware(g.target_date)
            if target and target < _now():
                add(_insight(ws, "risk",
                             f"Goal past target: {g.title}",
                             f"Target was {target.date().isoformat()} and the goal is still open.",
                             {"goalId": g.id, "targetDate": target.isoformat()}))
                continue
            has_issue = await _best_issue_match(goal_text, issues) is not None if issues else False
            has_plan = False
            for p in plans:
                if await _similar(goal_text, f"{p.name} {(p.prd or {}).get('title', '')}"):
                    has_plan = True
                    break
            due_soon = target and (target - _now()).days <= _GOAL_LOOKAHEAD_DAYS
            if not has_issue and not has_plan and (due_soon or not target):
                when = f" (target {target.date().isoformat()})" if target else ""
                add(_insight(ws, "gap",
                             f"No tracked work toward goal: {g.title}",
                             f"Nothing in Linear or the proposal pipeline matches this goal{when}.",
                             {"goalId": g.id}))

    db.add_all(found)
    await db.flush()
    return found


async def generate_brief(db, ws: str) -> Insight:
    """Render company context through the intelligence-brief agent and store
    the result as an Insight. Callable by the API and by the heartbeat."""
    import uuid as _uuid

    from ..agents import definitions as d
    from ..agents import fallback as fb
    from ..agents import schemas as s
    from ..config import settings
    from ..context.engine import build_company_context

    context = await build_company_context(db, ws)
    out = None
    if settings.ai_enabled:
        try:
            agent = d.build_agent(d.SYSTEM_PROMPTS["intelligence-brief"], s.IntelligenceBrief)
            result = await agent.run(context)
            out = result.output.model_dump(by_alias=True)
        except Exception:
            logger.warning("brief agent failed; using fallback", exc_info=True)
    if out is None:
        out = fb.fallback_brief(context)

    brief = Insight(
        id=f"in_{_uuid.uuid4().hex[:8]}", workspace_id=ws, kind="brief",
        title=out.get("headline", "Company brief")[:140], detail=out.get("summary", ""),
        evidence={"risks": out.get("risks", []), "highlights": out.get("highlights", []),
                  "recommendations": out.get("recommendations", [])},
        status="open", created_at=_now(),
    )
    db.add(brief)
    await db.flush()
    return brief
