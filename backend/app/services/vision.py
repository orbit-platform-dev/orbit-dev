"""Vision — the one seam that turns binary media (scanned PDFs, images) into
text for memory. Runs on the extractor model (vision-capable, high-quota);
returns "" on any failure so callers skip honestly instead of ingesting noise.
"""
from __future__ import annotations

import httpx

from ..config import settings

_MAX_BYTES = 8_000_000  
_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}

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
        result = await agent.run([
            f"Read this file ({name}).",
            BinaryContent(data=data, media_type=mime),
        ])
        return (result.output or "").strip()
    except Exception:
        return ""


async def fetch_image(url: str, auth: str | None = None) -> tuple[bytes, str] | None:
    """Download an image, passing the connector's auth through (private uploads
    on Linear/Slack need it). None unless the response really is a supported
    image within the size cap — an HTML login page must never reach the model."""
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            res = await client.get(url, headers={"Authorization": auth} if auth else {})
    except Exception:
        return None
    mime = (res.headers.get("content-type") or "").partition(";")[0].strip()
    if res.status_code != 200 or mime not in _IMAGE_MIMES or len(res.content) > _MAX_BYTES:
        return None
    return res.content, mime
