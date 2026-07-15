"""Embedding service — the semantic half of the Context Engine.

Turns text into vectors so retrieval can match MEANING ("federated login
broken" ≈ "SAML assertion errors"), not just shared words. Uses Gemini's
embedding model with the same LLM_API_KEY the pipeline already has; returns
None whenever embeddings are unavailable (AI off, no key, API error) so every
caller degrades to keyword/recency ranking — embedding failures must never
break ingestion or retrieval.
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

from ..config import settings
from ..models import EMBEDDING_DIM

logger = logging.getLogger("orbit.embeddings")

_GEMINI_URL = ("https://generativelanguage.googleapis.com/v1beta/models/"
               "{model}:embedContent?key={key}")
_MAX_CHARS = 6000  # embedding models truncate anyway; keep requests lean

# Circuit breaker. After a 429 (quota / rate limit) we PAUSE embedding calls for
# a cooldown instead of firing hundreds more doomed round-trips — that retry
# storm is what makes a large sync crawl. available() reports False during the
# pause, so every caller (ingest, backfill, search, chat) degrades to
# keyword/recency instantly instead of hanging.
_QUOTA_COOLDOWN_S = 60.0
_paused_until = 0.0


def _paused() -> bool:
    return time.monotonic() < _paused_until


def _trip_breaker() -> None:
    global _paused_until
    _paused_until = time.monotonic() + _QUOTA_COOLDOWN_S


def available() -> bool:
    return settings.ai_enabled and bool(settings.llm_api_key) and not _paused()


async def embed_text(text: str, *, task: str = "RETRIEVAL_DOCUMENT") -> list[float] | None:
    """One text → one vector, or None when embeddings can't be produced."""
    if not available() or not (text or "").strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(
                _GEMINI_URL.format(model=settings.embedding_model, key=settings.llm_api_key),
                json={"content": {"parts": [{"text": text[:_MAX_CHARS]}]}, "taskType": task,
                      "outputDimensionality": EMBEDDING_DIM},
            )
        if res.status_code == 429:
            _trip_breaker()  # quota/rate limited — stop hammering for a cooldown
            logger.warning("embedding quota/rate limit (429); pausing embeddings for %.0fs", _QUOTA_COOLDOWN_S)
            return None
        if res.status_code != 200:
            logger.warning("embedding request failed (%s): %s", res.status_code, res.text[:150])
            return None
        values = res.json().get("embedding", {}).get("values")
        return values if values and len(values) == EMBEDDING_DIM else None
    except Exception:
        logger.warning("embedding request errored", exc_info=True)
        return None


async def embed_query(text: str) -> list[float] | None:
    """Queries use the retrieval-query task type (asymmetric embedding)."""
    return await embed_text(text, task="RETRIEVAL_QUERY")


async def embed_many(texts: list[str]) -> list[list[float] | None]:
    return list(await asyncio.gather(*[embed_text(t) for t in texts]))


def cosine(a: list[float], b: list[float]) -> float:
    """Python-side similarity for the SQLite path (Postgres uses pgvector's index)."""
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0
