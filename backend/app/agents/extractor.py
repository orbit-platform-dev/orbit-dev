"""The Extractor — one of the MVP's two agents.

Turns a single artifact (a customer call transcript or a Linear work item) into
structured company memory. Degrades gracefully: with AI off or on any failure it
falls back to a deterministic, content-derived extraction so ingestion never
breaks and the product runs with no LLM at all.
"""
from __future__ import annotations

import logging

from ..config import settings
from .definitions import SYSTEM_PROMPTS, build_agent
from .schemas import ArtifactExtraction

logger = logging.getLogger("orbit.extractor")

_MAX_CONTENT = 8000  # keep prompts lean; long transcripts are clipped


def _fallback(title: str, content: str) -> ArtifactExtraction:
    """No-LLM extraction: a truthful summary snippet, nothing invented."""
    snippet = " ".join((content or title or "").split())[:280]
    return ArtifactExtraction(summary=snippet)


async def extract(kind: str, title: str, content: str, corrections: str = "") -> ArtifactExtraction:
    """`corrections` is the learned-corrections block (how humans edited/dismissed
    Orbit's recent output); prepended so extraction converges on the team's judgment."""
    # Linear issues are execution reality, not a source of commitments/requests.
    # Extract them deterministically — the full description is still stored and
    # embedded for matching, and a large issue backlog costs zero LLM calls and
    # never pollutes the model with spurious commitments. The LLM Extractor is
    # reserved for calls, where intent and commitments actually live.
    if kind == "issue" or not settings.ai_enabled:
        return _fallback(title, content)
    try:
        agent = build_agent(SYSTEM_PROMPTS["extractor"], ArtifactExtraction)
        prefix = f"{corrections}\n\n" if corrections else ""
        prompt = f"{prefix}ARTIFACT (kind: {kind}) titled \"{title}\":\n\n{(content or '')[:_MAX_CONTENT]}"
        result = await agent.run(prompt)
        return result.output
    except Exception:
        logger.warning("extractor failed; using fallback", exc_info=True)
        return _fallback(title, content)
