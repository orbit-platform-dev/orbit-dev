"""In-app feedback (bug / feature / other) → a Linear issue in our Orbit-dev
workspace. Auth-required; the image (optional) arrives as a data URL."""

from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ..deps import get_current_user
from ..services import feedback

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/feedback", tags=["feedback"])

_ALLOWED = {"bug", "feature", "other"}
_MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB decoded ceiling


class FeedbackIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    category: str
    description: str
    email: str | None = None
    image: str | None = None  # data URL: data:image/png;base64,....
    image_name: str | None = None


def _decode_data_url(data_url: str) -> tuple[bytes, str] | None:
    """(bytes, content_type) from a data: URL, or None if it isn't one/too big."""
    if not data_url.startswith("data:") or "," not in data_url:
        return None
    header, b64 = data_url.split(",", 1)
    content_type = header[5:].split(";", 1)[0] or "image/png"
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None
    if not raw or len(raw) > _MAX_IMAGE_BYTES:
        return None
    return raw, content_type


@router.post("")
async def submit_feedback(body: FeedbackIn, user=Depends(get_current_user)):
    if not feedback.configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Feedback isn't set up yet.")
    category = body.category if body.category in _ALLOWED else "other"
    description = (body.description or "").strip()
    if len(description) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add a short description.")

    email = (body.email or user.get("email") or user.get("sub") or "unknown").strip()
    image_bytes = image_type = None
    if body.image:
        decoded = _decode_data_url(body.image)
        if decoded:
            image_bytes, image_type = decoded

    try:
        issue = await feedback.submit(
            category=category,
            description=description,
            email=email,
            image=image_bytes,
            image_name=body.image_name,
            image_type=image_type,
        )
    except Exception as exc:
        logger.warning("feedback submit failed", exc_info=True)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not file the report: {exc}") from exc
    return {"identifier": issue["identifier"], "url": issue["url"]}
