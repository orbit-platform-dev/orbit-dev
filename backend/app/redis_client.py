"""Optional Redis client.

Redis backs response caching and the agent event stream. It is optional: when
REDIS_URL is unset or unreachable, the helpers below no-op so the API still runs.
"""
from __future__ import annotations

import json
from typing import Any

from .config import settings

try:  # redis is a hard dep, but guard so the app boots even if misconfigured
    from redis.asyncio import Redis
except Exception:  # pragma: no cover
    Redis = None  # type: ignore

_client: "Redis | None" = None


async def get_redis() -> "Redis | None":
    global _client
    if not settings.redis_url or Redis is None:
        return None
    if _client is None:
        _client = Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


async def cache_get(key: str) -> Any | None:
    client = await get_redis()
    if client is None:
        return None
    try:
        raw = await client.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int = 30) -> None:
    client = await get_redis()
    if client is None:
        return
    try:
        await client.set(key, json.dumps(value), ex=ttl)
    except Exception:
        pass


async def publish_event(stream: str, event: dict[str, Any]) -> None:
    """Publish an agent/pipeline event onto a Redis stream (best-effort)."""
    client = await get_redis()
    if client is None:
        return
    try:
        await client.xadd(stream, {k: json.dumps(v) for k, v in event.items()}, maxlen=1000)
    except Exception:
        pass
