"""Customer identity resolution.

Turns the free-text account label (typed by the user, or a Zoom topic) into a
real Customer row, so meetings/plans/knowledge attach to an entity instead of a
string. Matching is deterministic: normalized name, then aliases, then email
domains. Unmatched names create a new customer — a wrong merge is worse than a
duplicate the user can rename later.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from ..models import Customer

# Corporate suffixes that shouldn't affect identity ("Acme Inc" == "Acme").
_SUFFIXES = ("inc", "llc", "ltd", "gmbh", "corp", "corporation", "co", "kk", "sa", "srl", "plc")
_GENERIC = {"", "unknown account", "manual upload", "zoom import", "customer"}
_FREE_MAIL = {"gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com", "proton.me"}


def normalize_name(name: str) -> str:
    n = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower()).strip()
    words = [w for w in n.split() if w]
    while words and words[-1] in _SUFFIXES:
        words.pop()
    return " ".join(words)


def _domains_from(emails: list[str] | None) -> list[str]:
    out = []
    for e in emails or []:
        d = e.split("@")[-1].lower().strip()
        if d and "." in d and d not in _FREE_MAIL:
            out.append(d)
    return sorted(set(out))


async def resolve_customer(
    db, workspace_id: str, name_hint: str, attendee_emails: list[str] | None = None,
) -> Customer | None:
    """Find-or-create the Customer behind an account label. Returns None only
    when the hint is generic AND no domain evidence exists."""
    norm = normalize_name(name_hint)
    domains = _domains_from(attendee_emails)
    if norm in _GENERIC and not domains:
        return None

    rows = (await db.execute(
        select(Customer).where(Customer.workspace_id == workspace_id))).scalars().all()

    if norm not in _GENERIC:
        for c in rows:
            if c.normalized_name == norm or norm in [normalize_name(a) for a in (c.aliases or [])]:
                _learn(c, domains)
                return c
    for c in rows:
        if domains and set(domains) & set(c.domains or []):
            _learn(c, domains, alias=name_hint if norm not in _GENERIC else None)
            return c

    display = name_hint.strip() if norm not in _GENERIC else domains[0].split(".")[0].title()
    c = Customer(
        id=f"c_{uuid.uuid4().hex[:8]}", workspace_id=workspace_id, name=display,
        normalized_name=normalize_name(display), domains=domains, aliases=[],
        meta={}, created_at=datetime.now(timezone.utc),
    )
    db.add(c)
    await db.flush()
    return c


def _learn(c: Customer, domains: list[str], alias: str | None = None) -> None:
    if domains:
        c.domains = sorted(set(c.domains or []) | set(domains))
    if alias and normalize_name(alias) != c.normalized_name and alias not in (c.aliases or []):
        c.aliases = [*(c.aliases or []), alias]
