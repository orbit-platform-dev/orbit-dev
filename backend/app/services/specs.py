"""Spec generation — turn an engineering task into (1) a human overview and
(2) a self-contained markdown spec a coding agent (Cursor / Claude Code) can run.

Grounds the spec in the company's own memory: it retrieves related PRs, issues
and docs (the part a blank ChatGPT prompt can't provide) and feeds them to the
Spec Writer. Degrades to a deterministic spec when AI is off.
"""
from __future__ import annotations

import logging

from ..agents.definitions import SYSTEM_PROMPTS, build_agent
from ..agents.schemas import GeneratedSpec
from ..config import settings
from . import embeddings
from .model import search_artifacts

logger = logging.getLogger("orbit.specs")

_CONTEXT_RELEVANCE = 0.60   
_CONTEXT_K = 10


async def _retrieve_context(db, ws: str, query: str) -> list[dict]:
    """Related memory items (PRs, issues, docs) to ground the spec — [] when AI off."""
    if not embeddings.available():
        return []
    qv = await embeddings.embed_query(query)
    if not qv:
        return []
    hits = await search_artifacts(db, ws, qv, k=_CONTEXT_K, max_distance=1.0 - _CONTEXT_RELEVANCE)
    out: list[dict] = []
    for art, _score in hits:
        snippet = getattr(art, "_hit_snippet", None) or (art.content or "")[:1200]
        out.append({"source": art.source, "title": art.title, "ref": art.external_ref,
                    "url": art.url, "snippet": snippet.strip()})
    return out


def _context_block(ctx: list[dict]) -> str:
    if not ctx:
        return "(no closely related items found in company memory)"
    lines = []
    for c in ctx:
        head = f"- [{c['source']}] {c['title']}" + (f" ({c['ref']})" if c.get("ref") else "")
        if c.get("url"):
            head += f" {c['url']}"
        lines.append(head + (f"\n  {c['snippet'][:800]}" if c.get("snippet") else ""))
    return "\n".join(lines)


def _fallback(title: str, description: str, ctx: list[dict]) -> GeneratedSpec:
    """Deterministic spec when the model is unavailable — still useful, never fake."""
    ctx_lines = [f"- {c['source']}: {c['title']}" + (f" ({c['ref']})" if c.get("ref") else "") for c in ctx]
    hints = ("Related items:\n" + "\n".join(ctx_lines)) if ctx_lines else \
        "No closely related items were found in company memory."
    agent_md = (
        f"# Investigation: {title}\n\n"
        f"## Question\n{description or title}\n\n"
        f"## Steps\n"
        f"1. Confirm the current state and root cause from the linked work and code.\n"
        f"2. Identify who owns it and whether it's still needed.\n"
        f"{hints}\n\n"
        f"## Decide\n- Choose the response (fix in code, reassign/prioritize, clarify with the team, or tell "
        f"the customer) and act on it."
    )
    return GeneratedSpec(
        action_type="investigate",
        title=title, why=description or "", what=description or title,
        done_when=["Root cause confirmed and the right next step taken."],
        context=[f"{c['source']}: {c['title']}" for c in ctx],
        agent_spec=agent_md,
    )


async def generate(db, ws: str, *, title: str, description: str = "", extra_why: str = "") -> GeneratedSpec:
    """Generate the two-form spec for an engineering task. `extra_why` lets a Feed
    finding pass its origin (the promise/gap) for a richer 'why'."""
    title = (title or "").strip()[:200]
    description = (description or "").strip()
    ctx = await _retrieve_context(db, ws, f"{title}\n{description}")

    if not settings.ai_enabled or not embeddings.available():
        return _fallback(title, description, ctx)

    prompt = (
        f"FINDING\nTitle: {title}\nDetail: {description or '(none)'}\n"
        + (f"Origin: {extra_why}\n" if extra_why else "")
        + f"\nCONTEXT (from company memory)\n{_context_block(ctx)}\n\n"
        "Decide the action type and write the recommended action now."
    )
    try:
        agent = build_agent(SYSTEM_PROMPTS["spec-writer"], GeneratedSpec)  # smart (default) model
        res = await agent.run(prompt)
        return res.output
    except Exception:
        logger.warning("spec generation failed; using deterministic fallback", exc_info=True)
        return _fallback(title, description, ctx)
