"""Company model — the Understand layer.

Turns the Extractor's per-artifact output into a resolved graph of entities
(customers, commitments, features) connected by typed, provenance-backed links.
The link that matters most: a commitment made on a call is matched to the Linear
issue that fulfills it, or left flagged as untracked. Resolution is deterministic
and reuses the customer normalizer.
"""
from __future__ import annotations

import difflib
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select

from ..models import Artifact, Entity, Link
from . import embeddings

# Cosine floor for accepting a semantic (vector) commitment↔issue match.
_SEMANTIC_THRESHOLD = 0.75
_EMBED_CHUNK = 16  # bound concurrency when lazily embedding a batch of issues

# Corporate suffixes that shouldn't affect identity ("Acme Inc" == "Acme").
_SUFFIXES = ("inc", "llc", "ltd", "gmbh", "corp", "corporation", "co", "kk", "sa", "srl", "plc")


def normalize_name(name: str) -> str:
    """Identity key for entity resolution: lowercased, punctuation-stripped,
    corporate suffixes dropped. (Moved here from the retired customers service.)"""
    n = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower()).strip()
    words = [w for w in n.split() if w]
    while words and words[-1] in _SUFFIXES:
        words.pop()
    return " ".join(words)


# Short but meaningful tokens; acronyms like SSO/API matter, so keep len >= 3
# but drop common filler so overlap stays signal.
_STOP = {"the", "and", "for", "with", "this", "that", "will", "have", "from",
         "into", "your", "our", "are", "was", "before", "after", "them", "their"}


def _tokens(s: str) -> set[str]:
    return {w for w in normalize_name(s).split() if len(w) >= 3 and w not in _STOP}


def text_match(a: str, b: str) -> bool:
    """Deterministic 'do these describe the same thing' check: >= 2 shared
    significant tokens, or a high fuzzy ratio on the normalized strings."""
    ta, tb = _tokens(a), _tokens(b)
    if ta and (len(ta & tb) >= 2 or ta == tb):
        return True
    return difflib.SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio() >= 0.82


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def resolve_entity(db, ws: str, kind: str, name: str, *, meta: dict | None = None) -> Entity | None:
    """Find-or-create an entity of `kind` by normalized name (a wrong merge is
    worse than a duplicate). Returns None for empty names."""
    norm = normalize_name(name)
    if not norm:
        return None
    rows = (await db.execute(
        select(Entity).where(Entity.workspace_id == ws, Entity.kind == kind))).scalars().all()
    for e in rows:
        if e.normalized_name == norm or norm in [normalize_name(a) for a in (e.aliases or [])]:
            if meta:
                e.meta = {**(e.meta or {}), **{k: v for k, v in meta.items() if v}}
            e.updated_at = _now()
            return e
    e = Entity(
        id=f"en_{uuid.uuid4().hex[:10]}", workspace_id=ws, kind=kind,
        name=name.strip()[:200], normalized_name=norm, aliases=[], identifiers={},
        meta={k: v for k, v in (meta or {}).items() if v}, state="open",
        created_at=_now(), updated_at=_now(),
    )
    db.add(e)
    await db.flush()
    return e


async def ensure_link(db, ws: str, from_type: str, from_id: str, to_type: str, to_id: str,
                      link_type: str, *, source_artifact_id: str | None = None, meta: dict | None = None) -> Link:
    """Idempotent typed link between two nodes (entity or artifact)."""
    existing = (await db.execute(select(Link).where(
        Link.workspace_id == ws, Link.from_type == from_type, Link.from_id == from_id,
        Link.to_type == to_type, Link.to_id == to_id, Link.type == link_type,
    ))).scalars().first()
    if existing:
        if meta:
            existing.meta = {**(existing.meta or {}), **meta}
        return existing
    link = Link(
        id=f"lk_{uuid.uuid4().hex[:10]}", workspace_id=ws,
        from_type=from_type, from_id=from_id, to_type=to_type, to_id=to_id,
        type=link_type, source_artifact_id=source_artifact_id, meta=meta or {}, created_at=_now(),
    )
    db.add(link)
    await db.flush()
    return link


async def _link_commitment_issue(db, ws: str, commitment: Entity, iss: Artifact, *, via: str) -> None:
    """Record a commitment as fulfilled by a Linear issue (deterministic or vector)."""
    await ensure_link(db, ws, "artifact", iss.id, "entity", commitment.id, "fulfills",
                      source_artifact_id=iss.id,
                      meta={"identifier": iss.external_ref, "url": iss.url, "via": via})
    commitment.state = "tracked"
    commitment.meta = {**(commitment.meta or {}),
                       "linear": {"identifier": iss.external_ref, "url": iss.url}}
    commitment.updated_at = _now()


async def _ensure_embeddings(db, artifacts: list[Artifact]) -> None:
    """Lazily compute + persist embeddings for artifacts missing one. Called only
    when matching needs vectors, so ingest stays cheap. Concurrency is bounded."""
    missing = [a for a in artifacts if a.embedding is None]
    for i in range(0, len(missing), _EMBED_CHUNK):
        chunk = missing[i:i + _EMBED_CHUNK]
        vectors = await embeddings.embed_many([f"{a.title}\n{a.content[:2000]}" for a in chunk])
        for a, v in zip(chunk, vectors):
            if v:
                a.embedding = v
    if missing:
        await db.flush()


async def match_commitment_to_linear(db, ws: str, commitment: Entity) -> bool:
    """Link a commitment to the Linear issue that fulfills it, if one exists.
    Deterministic text match first (fast); a vector pass then catches semantic
    matches text misses. Sets state='tracked'; otherwise leaves it untracked."""
    issues = (await db.execute(select(Artifact).where(
        Artifact.workspace_id == ws, Artifact.source == "linear-issue"))).scalars().all()
    if not issues:
        return False

    # 1) Fast, deterministic pass on titles.
    for iss in issues:
        if text_match(commitment.name, iss.title):
            await _link_commitment_issue(db, ws, commitment, iss, via="text")
            return True

    # 2) Vector assist — catches "SSO" ↔ "single sign-on" that tokens miss.
    #    Embeddings are computed lazily here (open issues only), then cached.
    if embeddings.available():
        candidates = [i for i in issues
                      if (i.meta or {}).get("stateType") not in ("completed", "canceled")] or issues
        await _ensure_embeddings(db, candidates)
        query = await embeddings.embed_query(commitment.name)
        if query:
            best, best_iss = 0.0, None
            for iss in candidates:
                if iss.embedding:
                    score = embeddings.cosine(query, iss.embedding)
                    if score > best:
                        best, best_iss = score, iss
            if best_iss and best >= _SEMANTIC_THRESHOLD:
                await _link_commitment_issue(db, ws, commitment, best_iss, via="vector")
                return True
    return False


async def match_open_commitments(db, ws: str) -> int:
    """Re-match every still-open commitment against Linear (used after a pull).
    Returns how many became tracked."""
    open_commitments = (await db.execute(select(Entity).where(
        Entity.workspace_id == ws, Entity.kind == "commitment", Entity.state == "open"))).scalars().all()
    matched = 0
    for c in open_commitments:
        if await match_commitment_to_linear(db, ws, c):
            matched += 1
    if matched:
        await db.commit()
    return matched


async def build_from_artifact(db, ws: str, artifact: Artifact) -> None:
    """Resolve the entities and links implied by one artifact's extraction, then
    try to match any new commitments to Linear. Commits once at the end."""
    ex = artifact.extracted or {}

    customer_ents: dict[str, Entity] = {}
    for ent in ex.get("entities", []) or []:
        name, kind = (ent or {}).get("name", ""), (ent or {}).get("kind", "")
        if not name:
            continue
        if kind == "customer":
            c = await resolve_entity(db, ws, "customer", name)
            if c:
                customer_ents[normalize_name(name)] = c
                await ensure_link(db, ws, "artifact", artifact.id, "entity", c.id, "mentions",
                                  source_artifact_id=artifact.id)
        elif kind == "person":
            p = await resolve_entity(db, ws, "person", name)
            if p:
                await ensure_link(db, ws, "artifact", artifact.id, "entity", p.id, "mentions",
                                  source_artifact_id=artifact.id)

    primary_customer = next(iter(customer_ents.values()), None)

    for c in ex.get("commitments", []) or []:
        text = (c or {}).get("text", "")
        if not text:
            continue
        ce = await resolve_entity(db, ws, "commitment", text,
                                  meta={"to": c.get("to", ""), "due": c.get("due", "")})
        if not ce:
            continue
        await ensure_link(db, ws, "artifact", artifact.id, "entity", ce.id, "source_of",
                          source_artifact_id=artifact.id)
        to_name = c.get("to", "")
        cust = customer_ents.get(normalize_name(to_name)) if to_name else None
        if to_name and not cust:
            cust = await resolve_entity(db, ws, "customer", to_name)
        cust = cust or primary_customer
        if cust:
            await ensure_link(db, ws, "entity", ce.id, "entity", cust.id, "made_to")
        if ce.state == "open":
            await match_commitment_to_linear(db, ws, ce)

    for req in ex.get("requests", []) or []:
        if not req:
            continue
        fe = await resolve_entity(db, ws, "feature", req)
        if not fe:
            continue
        await ensure_link(db, ws, "artifact", artifact.id, "entity", fe.id, "source_of",
                          source_artifact_id=artifact.id)
        for cust in customer_ents.values():
            await ensure_link(db, ws, "entity", fe.id, "entity", cust.id, "requested_by")

    await db.commit()


async def neighbors(db, ws: str, entity_id: str) -> list[Link]:
    """All links touching an entity (either direction)."""
    return (await db.execute(select(Link).where(
        Link.workspace_id == ws, or_(Link.from_id == entity_id, Link.to_id == entity_id)))).scalars().all()
