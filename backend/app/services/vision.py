"""Vision — the one seam that turns binary media (scanned PDFs, images) into
text for memory. Runs on the extractor model (vision-capable, high-quota);
returns "" on any failure so callers skip honestly instead of ingesting noise.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

from ..config import settings

_MAX_BYTES = 8_000_000
_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}

# Only these hosts may receive a connector's auth token (private uploads live
# here). Everything else is fetched WITHOUT auth, so a token can never leak to a
# URL an attacker planted in issue/PR/message content.
_AUTHED_HOSTS = ("uploads.linear.app", ".slack.com", ".githubusercontent.com", ".googleusercontent.com")
_MAX_REDIRECTS = 3


def _public_host(host: str) -> bool:
    """SSRF guard: reject hosts that resolve to a private/loopback/link-local IP —
    e.g. the cloud metadata server 169.254.169.254, which hands out SA tokens."""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def _may_send_auth(host: str) -> bool:
    return any(host == h or host.endswith(h) for h in _AUTHED_HOSTS)


_DOC_PROMPT = (
    "You transcribe documents. Output ONLY the text visible in the file, in reading "
    "order, rendering tables as plain aligned lines. No commentary, no translation, "
    "no descriptions of images — text content only."
)
_IMAGE_PROMPT = (
    "You read images for a company memory system. Output the text visible in the image "
    "verbatim; if it is a chart, diagram or screenshot, add one line stating what it "
    "shows. No speculation, no filler."
)


async def transcribe(data: bytes, mime: str, name: str = "") -> str:
    if not settings.ai_enabled or not data or len(data) > _MAX_BYTES:
        return ""
    from pydantic_ai import Agent, BinaryContent

    from ..agents.model_service import build_model

    prompt = _IMAGE_PROMPT if mime.startswith("image/") else _DOC_PROMPT
    agent = Agent(build_model(settings.extractor_model), system_prompt=prompt, retries=1)
    try:
        result = await agent.run(
            [
                f"Read this file ({name}).",
                BinaryContent(data=data, media_type=mime),
            ]
        )
        return (result.output or "").strip()
    except Exception:
        return ""


async def fetch_image(url: str, auth: str | None = None) -> tuple[bytes, str] | None:
    """Download an image for the model. Auth is forwarded ONLY to known connector
    hosts (`_AUTHED_HOSTS`) and only on the first hop; redirects are followed
    manually so every hop's host is SSRF-checked (no private/metadata IPs) and no
    token is carried to a redirect target. None unless the response really is a
    supported image within the size cap — an HTML login page must never reach the
    model."""
    res = None
    for _ in range(_MAX_REDIRECTS + 1):
        host = (urlparse(url).hostname or "").lower()
        if not _public_host(host):
            return None
        headers = {"Authorization": auth} if (auth and _may_send_auth(host)) else {}
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
                res = await client.get(url, headers=headers)
        except Exception:
            return None
        if res.status_code in (301, 302, 303, 307, 308) and res.headers.get("location"):
            url, auth = urljoin(url, res.headers["location"]), None  # never forward the token past a redirect
            continue
        break
    if res is None or res.status_code != 200:
        return None
    mime = (res.headers.get("content-type") or "").partition(";")[0].strip()
    if mime not in _IMAGE_MIMES or len(res.content) > _MAX_BYTES:
        return None
    return res.content, mime
