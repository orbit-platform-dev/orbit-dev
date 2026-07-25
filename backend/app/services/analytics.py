"""Deterministic analytics over memory — the STRUCTURED query path chat lacks.

Top-k semantic retrieval (RAG) can answer "what is X about" but NOT "how many",
"created today", "average time to close", "who owns the most open work" — those
are aggregations, not similarity. `memory_stats` computes live counts from the
artifacts' structured `meta` (no LLM, no embeddings, quota-proof) and is injected
into the chat context so the agent — and the degraded fallback — answer
quantitative questions from the company's real data instead of guessing.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..models import Artifact


def _day(iso: str | None) -> str:
    return (iso or "")[:10]


async def memory_stats(db, ws: str) -> str:
    """A compact, live stats block over the workspace's memory. '' when empty.
    Reads only lean columns (source, meta, occurred_at) — never the embedding."""
    rows = (
        await db.execute(
            select(Artifact.source, Artifact.meta, Artifact.occurred_at).where(Artifact.workspace_id == ws)
        )
    ).all()
    if not rows:
        return ""

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    by_source = Counter(r.source for r in rows)

    lines = [
        "MEMORY STATS (live counts from the company's OWN data — use these for "
        "'how many', totals, dates and averages; never guess a number):",
        "- Artifacts by source: " + ", ".join(f"{k}={v}" for k, v in sorted(by_source.items())),
    ]

    linear = [r.meta or {} for r in rows if r.source == "linear-issue"]
    if linear:
        completed = [m for m in linear if m.get("stateType") == "completed"]
        open_ = [m for m in linear if m.get("stateType") not in ("completed", "canceled")]
        created_today = sum(1 for m in linear if _day(m.get("createdAt")) == today)
        created_week = sum(1 for m in linear if _day(m.get("createdAt")) >= week_ago)
        cycles = [m["cycleTimeDays"] for m in completed if isinstance(m.get("cycleTimeDays"), (int, float))]
        avg_cycle = round(sum(cycles) / len(cycles), 1) if cycles else None

        lines.append(
            f"- Linear issues: {len(linear)} total · {len(open_)} open · {len(completed)} completed "
            f"· {created_today} created today ({today}) · {created_week} created in the last 7 days"
        )
        if avg_cycle is not None:
            lines.append(f"- Avg time to close: {avg_cycle} days (over {len(cycles)} completed tickets)")
        projects = Counter(m.get("project") for m in open_ if m.get("project"))
        if projects:
            lines.append("- Open work by project: " + ", ".join(f"{p} ({n})" for p, n in projects.most_common(5)))
        assignees = Counter(m.get("assignee") for m in open_ if m.get("assignee"))
        if assignees:
            lines.append("- Open work by assignee: " + ", ".join(f"{a} ({n})" for a, n in assignees.most_common(8)))
        done_by = Counter(m.get("assignee") for m in completed if m.get("assignee"))
        if done_by:
            lines.append(
                "- Completed (done) work by assignee: " + ", ".join(f"{a} ({n})" for a, n in done_by.most_common(10))
            )

    gh = [r.meta or {} for r in rows if r.source in ("github-pr", "github-issue")]
    if gh:
        prs = [m for m in gh if m.get("isPr")]
        open_prs = [m for m in prs if m.get("stateType") not in ("completed", "canceled")]
        merged = [m for m in prs if m.get("state") == "merged"]
        lines.append(
            f"- GitHub: {len(prs)} PRs ({len(open_prs)} open · {len(merged)} merged) · {len(gh) - len(prs)} issues"
        )
        authors = Counter(m.get("creator") for m in open_prs if m.get("creator"))
        if authors:
            lines.append("- Open PRs by author: " + ", ".join(f"{a} ({n})" for a, n in authors.most_common(8)))
        repos = Counter(m.get("project") for m in open_prs if m.get("project"))
        if repos:
            lines.append("- Open PRs by repo: " + ", ".join(f"{p} ({n})" for p, n in repos.most_common(5)))

    return "\n".join(lines)
