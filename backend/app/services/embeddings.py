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

_CACHE_MAX = 512
_vec_cache: dict[tuple[str, str], list[float]] = {}

_EMBED_CONCURRENCY = 16
_http: httpx.AsyncClient | None = None
_http_loop: asyncio.AbstractEventLoop | None = None


def _client() -> httpx.AsyncClient:
    global _http, _http_loop
    loop = asyncio.get_running_loop()
    if _http is None or _http.is_closed or _http_loop is not loop:
        _http = httpx.AsyncClient(
            timeout=20,
            limits=httpx.Limits(max_connections=_EMBED_CONCURRENCY, max_keepalive_connections=8),
        )
        _http_loop = loop
    return _http


def _paused() -> bool:
    return time.monotonic() < _paused_until


def _trip_breaker() -> None:
    global _paused_until
    _paused_until = time.monotonic() + _QUOTA_COOLDOWN_S


def available() -> bool:
    return settings.ai_enabled and bool(settings.llm_api_key) and not _paused()


def _request_body(text: str, task: str) -> dict:
    """gemini-embedding-001 takes a taskType parameter; gemini-embedding-2 (and
    later) rejects it — the task is encoded as a prompt prefix instead, and the
    prefix style must match between stored documents and queries. Vectors from
    different models are NOT comparable: changing EMBEDDING_MODEL requires
    re-embedding everything (fresh DB, or null the embedding columns and let the
    startup backfill rebuild them)."""
    model = settings.embedding_model or ""
    if model.startswith("gemini-embedding-") and model != "gemini-embedding-001":
        prefix = ("task: search result | query: " if task == "RETRIEVAL_QUERY"
                  else "title: none | text: ")
        return {"content": {"parts": [{"text": prefix + text}]},
                "outputDimensionality": EMBEDDING_DIM}
    return {"content": {"parts": [{"text": text}]}, "taskType": task,
            "outputDimensionality": EMBEDDING_DIM}


async def embed_text(text: str, *, task: str = "RETRIEVAL_DOCUMENT") -> list[float] | None:
    """One text → one vector, or None when embeddings can't be produced."""
    if not available() or not (text or "").strip():
        return None
    key = (task, text[:_MAX_CHARS])
    cached = _vec_cache.get(key)
    if cached is not None:
        return cached
    try:
        res = await _client().post(
            _GEMINI_URL.format(model=settings.embedding_model, key=settings.llm_api_key),
            json=_request_body(text[:_MAX_CHARS], task),
        )
        if res.status_code == 429:
            _trip_breaker()  # quota/rate limited — stop hammering for a cooldown
            logger.warning("embedding quota/rate limit (429); pausing embeddings for %.0fs", _QUOTA_COOLDOWN_S)
            return None
        if res.status_code != 200:
            logger.warning("embedding request failed (%s): %s", res.status_code, res.text[:150])
            return None
        values = res.json().get("embedding", {}).get("values")
        if not (values and len(values) == EMBEDDING_DIM):
            return None
        if len(_vec_cache) >= _CACHE_MAX:
            _vec_cache.pop(next(iter(_vec_cache)), None)
        _vec_cache[key] = values
        return values
    except Exception:
        logger.warning("embedding request errored", exc_info=True)
        return None


async def embed_query(text: str) -> list[float] | None:
    """Queries use the retrieval-query task type (asymmetric embedding)."""
    return await embed_text(text, task="RETRIEVAL_QUERY")


async def embed_many(texts: list[str]) -> list[list[float] | None]:
    sem = asyncio.Semaphore(_EMBED_CONCURRENCY)

    async def one(t: str) -> list[float] | None:
        async with sem:
            return await embed_text(t)

    return list(await asyncio.gather(*[one(t) for t in texts]))


def cosine(a: list[float], b: list[float]) -> float:
    """Python-side similarity for the SQLite path (Postgres uses pgvector's index)."""
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


_LEGACY_MODEL = "gemini-embedding-001"


async def ensure_vector_space(db) -> None:
    """Startup guard: vectors from different embedding models are incompatible,
    so if the configured EMBEDDING_MODEL differs from the one a workspace's
    stored vectors were made with, null them all — the regular backfills then
    re-embed with the new model. Makes model switches (e.g. the dev→prod
    embedding upgrade) safe with zero manual DB surgery."""
    from sqlalchemy import null, select, update

    from ..models import Artifact, ArtifactChunk, Feedback, Memory, Workspace

    configured = settings.embedding_model or _LEGACY_MODEL
    for ws in (await db.execute(select(Workspace))).scalars().all():
        marker = ws.embedding_model
        if marker is None:
            has_vectors = (await db.execute(
                select(Artifact.id).where(Artifact.workspace_id == ws.id,
                                          Artifact.embedding.is_not(None)).limit(1))).scalar_one_or_none()
            marker = _LEGACY_MODEL if has_vectors else configured
        if marker != configured:
            logger.warning("workspace %s: embedding model %s → %s; clearing stored vectors for re-embed",
                           ws.id, marker, configured)
            # sa.null(), not None: a Python None through the JSON column type can
            # land as the JSON text 'null', which "IS NULL" queries (backfill,
            # retrieval) would miss. null() always emits SQL NULL.
            for table in (Artifact, ArtifactChunk, Feedback, Memory):
                await db.execute(update(table).where(table.workspace_id == ws.id)
                                 .values(embedding=null()))
        ws.embedding_model = configured
    await db.commit()
