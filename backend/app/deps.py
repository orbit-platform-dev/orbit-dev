"""Request dependencies: DB session + optional Clerk JWT auth.

When CLERK_JWKS_URL is unset, auth is disabled and a demo principal is returned
so the API runs open in development. When set, bearer tokens are verified
against Clerk's JWKS.
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import Depends, Header, HTTPException, status

from .config import settings
from .database import get_db  # re-exported for routers

_jwks_cache: dict[str, Any] | None = None

DEMO_PRINCIPAL = {"sub": "demo_user", "email": "yash@batton.co.jp", "name": "Yash Pandey"}


async def _get_jwks() -> dict[str, Any]:
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(settings.clerk_jwks_url)  # type: ignore[arg-type]
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not settings.clerk_jwks_url:
        return DEMO_PRINCIPAL  # auth disabled (dev/demo)

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    token = authorization.split(" ", 1)[1]
    try:
        from jose import jwt
        from jose.utils import base64url_decode  # noqa: F401  (ensures crypto extras present)

        jwks = await _get_jwks()
        header = jwt.get_unverified_header(token)
        key = next((k for k in jwks["keys"] if k["kid"] == header["kid"]), None)
        if key is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown signing key")
        claims = jwt.decode(
            token, key, algorithms=[header.get("alg", "RS256")],
            issuer=settings.clerk_issuer, options={"verify_aud": False},
        )
        return claims
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc


__all__ = ["get_db", "get_current_user", "Depends"]
