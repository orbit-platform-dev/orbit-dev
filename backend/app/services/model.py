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

from pgvector.sqlalchemy import Vector
from sqlalchemy import cast, or_, select

from ..database import engine
from ..models import EMBEDDING_DIM, Artifact, Entity, Link
from . import embeddings

_SEMANTIC_THRESHOLD = 0.75

_SEMANTIC_MAX_DISTANCE = 1.0 - _SEMANTIC_THRESHOLD

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


def _is_postgres() -> bool:
    """pgvector's native distance operators exist only on Postgres; SQLite (dev)
    falls back to an in-Python scan. Decided by the live engine's dialect."""
    return engine.dialect.name == "postgresql"


async def search_artifacts(
    db,
    ws: str,
    query_vector: list[float],
    *,
    k: int = 8,
    sources: list[str] | None = None,
    exclude_ids: list[str] | None = None,
    max_distance: float = _SEMANTIC_MAX_DISTANCE,
) -> list[tuple[Artifact, float]]:
    """Nearest artifacts to a query vector — workspace-scoped and STRICTLY READ-ONLY.

    Postgres: a native pgvector cosine-distance query (`<=>`) that the HNSW index
    (``ix_artifacts_embedding``) accelerates — it scans all history, with no row
    cap. SQLite (dev): a bounded in-Python cosine scan over the workspace's
    embedded rows. Both drop anything beyond ``max_distance`` (default: cosine
    similarity below 0.75). Returns ``(artifact, similarity)`` pairs, nearest
    first.

    This never generates or writes embeddings — vectors are produced eagerly at
    ingest (``ingestion.ingest_artifact``) or by ``ingestion.backfill_embeddings``.

    NOTE: the column is ``JSON().with_variant(Vector, "postgresql")``, so its ORM
    comparator is JSON's — ``Artifact.embedding.cosine_distance`` does not exist.
    We ``cast(...)`` to ``Vector`` to reach pgvector's operator.
    """
    if not query_vector:
        return []

    if _is_postgres():
        distance = cast(Artifact.embedding, Vector(EMBEDDING_DIM)).cosine_distance(query_vector)
        stmt = select(Artifact, distance.label("distance")).where(
            Artifact.workspace_id == ws, Artifact.embedding.isnot(None)
        )
        if sources:
            stmt = stmt.where(Artifact.source.in_(sources))
        if exclude_ids:
            stmt = stmt.where(Artifact.id.notin_(exclude_ids))
        stmt = stmt.where(distance <= max_distance).order_by(distance).limit(k)
        rows = (await db.execute(stmt)).all()
        return [(art, 1.0 - float(dist)) for art, dist in rows]

    # SQLite: no vector index — score in Python over the workspace's embedded rows.
    stmt = select(Artifact).where(Artifact.workspace_id == ws, Artifact.embedding.isnot(None))
    if sources:
        stmt = stmt.where(Artifact.source.in_(sources))
    if exclude_ids:
        stmt = stmt.where(Artifact.id.notin_(exclude_ids))
    rows = (await db.execute(stmt)).scalars().all()
    floor = 1.0 - max_distance
    scored = [(a, embeddings.cosine(query_vector, a.embedding)) for a in rows if a.embedding]
    scored = [(a, s) for a, s in scored if s >= floor]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]


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


async def match_commitment_to_linear(db, ws: str, commitment: Entity) -> bool:
    """Link a commitment to the Linear issue that fulfills it, if one exists.
    Deterministic text match first (fast); a native vector pass then catches
    semantic matches text misses. Sets state='tracked'; otherwise leaves it
    untracked. READ-ONLY w.r.t. embeddings — issues are embedded at ingest, so
    the query vector is the only thing computed here and it is never persisted."""
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
    #    search_artifacts already applies the similarity floor; take the nearest
    #    non-canceled issue.
    if embeddings.available():
        query = await embeddings.embed_query(commitment.name)
        if query:
            results = await search_artifacts(db, ws, query, k=5, sources=["linear-issue"])
            for iss, _score in results:
                if (iss.meta or {}).get("stateType") == "canceled":
                    continue  # a canceled ticket doesn't fulfill anything
                await _link_commitment_issue(db, ws, commitment, iss, via="vector")
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


WORK_SOURCES = ("linear-issue", "github-pr", "github-issue")


async def link_work_entities(db, ws: str, artifact: Artifact) -> None:
    """Build the ownership graph from a work item's structured meta (no LLM) —
    identical for every connector because meta uses one key vocabulary:
    Person -assigned_to-> Item, Person -created-> Item, Item -belongs_to->
    Project, Person -works_on-> Project. Idempotent; caller commits."""
    if artifact.source not in WORK_SOURCES:
        return
    m = artifact.meta or {}
    assignee_ent = None
    if m.get("assignee"):
        assignee_ent = await resolve_entity(db, ws, "person", m["assignee"], meta={"email": m.get("assigneeEmail")})
        if assignee_ent:
            await ensure_link(db, ws, "entity", assignee_ent.id, "artifact", artifact.id,
                              "assigned_to", source_artifact_id=artifact.id)
    if m.get("creator") and m.get("creator") != m.get("assignee"):
        ce = await resolve_entity(db, ws, "person", m["creator"])
        if ce:
            await ensure_link(db, ws, "entity", ce.id, "artifact", artifact.id,
                              "created", source_artifact_id=artifact.id)
    if m.get("project"):
        pr = await resolve_entity(db, ws, "project", m["project"], meta={"state": m.get("projectState")})
        if pr:
            await ensure_link(db, ws, "artifact", artifact.id, "entity", pr.id, "belongs_to",
                              source_artifact_id=artifact.id)
            if assignee_ent:
                await ensure_link(db, ws, "entity", assignee_ent.id, "entity", pr.id, "works_on")


async def build_from_artifact(db, ws: str, artifact: Artifact) -> None:
    """Resolve the entities and links implied by one artifact's extraction, then
    try to match any new commitments to Linear. Commits once at the end."""
    ex = artifact.extracted or {}

    # Deterministic ownership graph from the work item's structured fields.
    await link_work_entities(db, ws, artifact)

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
