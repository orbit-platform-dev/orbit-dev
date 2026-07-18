"""Google Drive integration — the document sensor (Docs, Sheets, Slides).

Same connector seam as Linear/Slack/GitHub with one Google-specific twist:
access tokens expire hourly, so credentials persist the refresh token and
`get_auth` refreshes in place when needed. Read-only scope; all calls are live —
failures raise, callers degrade.
"""
from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..models import Integration
from . import vision

_API = "https://www.googleapis.com/drive/v3"
_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN = "https://oauth2.googleapis.com/token"
_SCOPE = "https://www.googleapis.com/auth/drive.readonly"

_MAX_FILES = 30
_EXPORT_CLIP = 20000

_MIME_EXPORT = {
    "application/vnd.google-apps.document": ("text/plain", "gdrive-doc", "doc"),
    "application/vnd.google-apps.spreadsheet": ("text/csv", "gdrive-sheet", "doc"),
    "application/vnd.google-apps.presentation": ("text/plain", "gdrive-slides", "doc"),
}
_PDF_MIME = "application/pdf"
_PDF_MIN_TEXT = 200
_PDF_MAX_BYTES = 15_000_000
_IMAGE_MIMES = ("image/png", "image/jpeg", "image/webp")
_VISION_PER_SYNC = 3


def oauth_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def oauth_url(state: str) -> str:
    return _AUTHORIZE + "?" + urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": settings.gdrive_redirect_uri,
        "response_type": "code",
        "scope": _SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    })


async def exchange_code(code: str) -> dict[str, Any]:
    """Returns the full credential dict — access, refresh and expiry must all be
    persisted (unlike the single-token providers)."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_TOKEN, data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.gdrive_redirect_uri,
            "code": code,
            "grant_type": "authorization_code",
        })
    if res.status_code != 200:
        raise RuntimeError(f"Google token exchange failed: {res.text[:150]}")
    body = res.json()
    token = body.get("access_token")
    if not token:
        raise RuntimeError("Google returned no access token")
    return {
        "accessToken": token,
        "refreshToken": body.get("refresh_token"),
        "expiresAt": time.time() + body.get("expires_in", 3600) - 60,
    }


async def _refresh(refresh_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(_TOKEN, data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
    if res.status_code != 200:
        raise RuntimeError(f"Google token refresh failed: {res.text[:150]}")
    body = res.json()
    return {
        "accessToken": body["access_token"],
        "expiresAt": time.time() + body.get("expires_in", 3600) - 60,
    }


async def get_auth(db, workspace_id: str = "ws_default") -> str | None:
    """Bearer header for this workspace's Drive connection, refreshing the
    expired access token in place. Flushes; caller commits."""
    integ = await db.get(Integration, {"workspace_id": workspace_id, "key": "google-drive"})
    cred = (integ.credentials or {}) if integ else {}
    if not cred.get("accessToken"):
        return None
    if time.time() >= cred.get("expiresAt", 0) and cred.get("refreshToken"):
        integ.credentials = {**cred, **await _refresh(cred["refreshToken"])}
        await db.flush()
        cred = integ.credentials
    return f"Bearer {cred['accessToken']}"


async def _get(auth: str, url: str, params: dict | None = None, *, raw: bool = False) -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(url, params=params or {}, headers={"Authorization": auth})
    if res.status_code != 200:
        raise RuntimeError(f"Google Drive API error {res.status_code}: {res.text[:150]}")
    return res.text if raw else res.json()


async def account_name(auth: str) -> str:
    about = await _get(auth, f"{_API}/about", {"fields": "user(displayName,emailAddress)"})
    user = about.get("user") or {}
    return user.get("emailAddress") or user.get("displayName") or "Google Drive"


def _pdf_text(data: bytes) -> str:
    """Text layer of a PDF. Empty string for scanned/image PDFs (no OCR)."""
    import io

    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception:
        return ""


async def file_exists(auth: str, file_id: str) -> bool:
    """False ONLY when the file is gone or trashed — the deletion signal for
    reconcile. Transient/API errors raise; deletion needs proof, not doubt."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{_API}/files/{file_id}", params={"fields": "id,trashed"},
                               headers={"Authorization": auth})
    if res.status_code == 404:
        return False
    if res.status_code != 200:
        raise RuntimeError(f"Google Drive API error {res.status_code}: {res.text[:150]}")
    return not res.json().get("trashed")


async def _get_bytes(auth: str, url: str, params: dict | None = None) -> bytes:
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(url, params=params or {}, headers={"Authorization": auth})
    if res.status_code != 200:
        raise RuntimeError(f"Google Drive download error {res.status_code}")
    return res.content


async def fetch_documents(
    auth: str, since: str | None = None, known: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], set[str]]:
    """The most recently modified Docs/Sheets/Slides + PDFs (text layer, else
    OCR) + images (read by the vision model). `since` (ISO) narrows to files
    modified after the cursor. `known` maps file id → modifiedTime already in
    memory: unchanged files are listed (for reconcile) but never re-downloaded
    or re-read. Returns (docs, listed_ids)."""
    mimes = " or ".join(f"mimeType='{m}'" for m in [*_MIME_EXPORT, _PDF_MIME, *_IMAGE_MIMES])
    q = f"({mimes}) and trashed=false"
    if since:
        q += f" and modifiedTime > '{since}'"
    listing = await _get(auth, f"{_API}/files", {
        "q": q,
        "orderBy": "modifiedTime desc",
        "pageSize": _MAX_FILES,
        "fields": "files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress))",
    })
    out: list[dict[str, Any]] = []
    listed: set[str] = set()
    budget = _VISION_PER_SYNC
    for f in listing.get("files", []):
        listed.add(f["id"])
        if known and known.get(f["id"]) == f.get("modifiedTime"):
            continue  # unchanged since last ingest — content fetch would be wasted
        ocr = False
        if f["mimeType"] == _PDF_MIME:
            source, kind = "gdrive-pdf", "doc"
            if int(f.get("size") or 0) > _PDF_MAX_BYTES:
                continue
            try:
                data = await _get_bytes(auth, f"{_API}/files/{f['id']}", {"alt": "media"})
            except Exception:
                continue
            text = _pdf_text(data)
            if len(text) < _PDF_MIN_TEXT and budget > 0:
                budget -= 1
                text = await vision.transcribe(data, _PDF_MIME, f.get("name") or "document")
                ocr = len(text) >= _PDF_MIN_TEXT
            if len(text) < _PDF_MIN_TEXT:
                continue  # unreadable even with OCR (or budget spent) — retried next sync
        elif f["mimeType"] in _IMAGE_MIMES:
            source, kind = "gdrive-image", "doc"
            if budget <= 0:
                continue  # retried next sync
            budget -= 1
            try:
                data = await _get_bytes(auth, f"{_API}/files/{f['id']}", {"alt": "media"})
            except Exception:
                continue
            text = await vision.transcribe(data, f["mimeType"], f.get("name") or "image")
            if not text:
                continue
            ocr = True
        else:
            export_mime, source, kind = _MIME_EXPORT[f["mimeType"]]
            try:
                text = await _get(auth, f"{_API}/files/{f['id']}/export", {"mimeType": export_mime}, raw=True)
            except Exception:
                continue  # one unexportable file must not sink the sync
        owner = (f.get("owners") or [{}])[0]
        out.append({
            "id": f["id"], "source": source, "kind": kind,
            "title": f.get("name") or "Untitled",
            "content": (text or "").strip()[:_EXPORT_CLIP],
            "url": f.get("webViewLink"),
            "modifiedAt": f.get("modifiedTime"), "createdAt": f.get("createdTime"),
            "owner": owner.get("displayName"), "ownerEmail": owner.get("emailAddress"),
            "ocr": ocr,
        })
    return out, listed
