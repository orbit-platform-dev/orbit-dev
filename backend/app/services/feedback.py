"""In-app feedback → a Linear issue in OUR Orbit-dev workspace.

Deliberately uses `settings.orbit_linear_api_key` (a dedicated key for our own
Linear), NOT any customer's connected connector credentials. Every report is
tagged with the configured label ("MVP Requests") plus its category, so they're
easy to triage. Unavailable (503) when the key isn't configured.
"""
from __future__ import annotations

from ..config import settings
from . import linear

# UI category -> (title prefix, Linear label). Extend here to add a category.
_CATEGORIES = {
    "bug": ("Bug", "Bug"),
    "feature": ("Feature", "Feature request"),
    "other": ("Feedback", "Other"),
}


def configured() -> bool:
    return bool(settings.orbit_linear_api_key)


async def submit(*, category: str, description: str, email: str,
                 image: bytes | None = None, image_name: str | None = None,
                 image_type: str | None = None) -> dict[str, str]:
    """File the report as a Linear issue; returns {identifier, url}. Raises if the
    feature isn't configured or Linear rejects the write."""
    key = settings.orbit_linear_api_key
    if not key:
        raise RuntimeError("Feedback is not configured")

    prefix, category_label = _CATEGORIES.get(category, _CATEGORIES["other"])
    team_id = settings.orbit_linear_team_id or await linear._first_team_id(key)

    # Tag with the MVP label + the category so triage can filter both.
    label_ids: list[str] = []
    for name in (settings.orbit_linear_label, category_label):
        lid = await linear.find_or_create_label(key, team_id, name)
        if lid and lid not in label_ids:
            label_ids.append(lid)

    body = (description or "").strip()
    if image:
        asset = await linear.upload_file(key, image_name or "screenshot.png",
                                         image_type or "image/png", image)
        if asset:
            body += f"\n\n![{image_name or 'screenshot'}]({asset})"
    body += f"\n\n---\nReported by: {email}\nCategory: {category_label}"

    # Title: the first line of the description (so triage reads well), prefixed.
    first_line = next((ln.strip() for ln in (description or "").splitlines() if ln.strip()), category_label)
    title = f"[{prefix}] {first_line}"[:255]

    return await linear.create_issue(key, title, body, team_id=team_id, label_ids=label_ids)
