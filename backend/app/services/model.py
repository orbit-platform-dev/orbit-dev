"""Company model — the Understand layer.

Turns the Extractor's per-artifact output into a resolved graph of entities
(customers, commitments, features) connected by typed, provenance-backed links.
The link that matters most: a commitment made on a call is matched to the Linear
issue that fulfills it, or left flagged as untracked. Resolution is deterministic
and reuses the customer normalizer.
"""

from __future__ import annotations

import difflib
import logging
import re
import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import cast, delete, or_, select

from ..database import engine
from ..models import EMBEDDING_DIM, Artifact, ArtifactChunk, Entity, Link
from . import embeddings

logger = logging.getLogger("orbit.model")

TICKET_REF = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b")

_SEMANTIC_THRESHOLD = 0.75

_SEMANTIC_MAX_DISTANCE = 1.0 - _SEMANTIC_THRESHOLD

_SUFFIXES = ("inc", "llc", "ltd", "gmbh", "corp", "corporation", "co", "kk", "sa", "srl", "plc")


def normalize_name(name: str) -> str:
    """Identity key for entity resolution: lowercased, punctuation-stripped,
    corporate suffixes dropped. (Moved here from the retired customers service.)"""
    n = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower()).strip()
    words = [w for w in n.split() if w]
    while words and words[-1] in _SUFFIXES:
        words.pop()
    return " ".join(words)


_STOP = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "will",
    "have",
    "from",
    "into",
    "your",
    "our",
    "are",
    "was",
    "before",
    "after",
    "them",
    "their",
}


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

    Searches BOTH the artifact-level vector (its title + opening) AND per-chunk
    vectors (passages deep inside long documents), then merges to the parent
    artifact keeping its best similarity. A chunk match attaches the matched
    passage to the returned artifact as ``_hit_snippet`` so callers can feed the
    RELEVANT passage to the model, not just the opening. This is what makes a
    point buried on page 7 of a spec findable.

    Postgres: native pgvector cosine (`<=>`) over both tables, HNSW-accelerated,
    scanning all history. SQLite (dev): a bounded in-Python cosine scan. Both drop
    anything beyond ``max_distance`` (default: similarity below 0.75). Returns
    ``(artifact, similarity)`` pairs, nearest first.

    This never generates or writes embeddings — vectors are produced eagerly at
    ingest (``ingestion.ingest_artifact`` / ``_write_chunks``) or by the
    ``ingestion.backfill_*`` passes.

    NOTE: the column is ``JSON().with_variant(Vector, "postgresql")``, so its ORM
    comparator is JSON's — ``.cosine_distance`` does not exist. We ``cast(...)`` to
    ``Vector`` to reach pgvector's operator.
    """
    if not query_vector:
        return []

    best: dict[str, float] = {}  # artifact_id -> best similarity (across its own + chunk vectors)
    arts: dict[str, Artifact] = {}  # loaded parent artifacts
    snippet: dict[str, str] = {}  # artifact_id -> matched passage (only when a chunk won)

    if _is_postgres():
        adist = cast(Artifact.embedding, Vector(EMBEDDING_DIM)).cosine_distance(query_vector)
        astmt = select(Artifact, adist.label("distance")).where(
            Artifact.workspace_id == ws, Artifact.embedding.isnot(None)
        )
        if sources:
            astmt = astmt.where(Artifact.source.in_(sources))
        if exclude_ids:
            astmt = astmt.where(Artifact.id.notin_(exclude_ids))
        astmt = astmt.where(adist <= max_distance).order_by(adist).limit(k)
        for art, dist in (await db.execute(astmt)).all():
            arts[art.id] = art
            best[art.id] = 1.0 - float(dist)

        cdist = cast(ArtifactChunk.embedding, Vector(EMBEDDING_DIM)).cosine_distance(query_vector)
        cstmt = select(ArtifactChunk.artifact_id, ArtifactChunk.text, cdist.label("distance")).where(
            ArtifactChunk.workspace_id == ws, ArtifactChunk.embedding.isnot(None)
        )
        if sources:
            cstmt = cstmt.where(ArtifactChunk.source.in_(sources))
        if exclude_ids:
            cstmt = cstmt.where(ArtifactChunk.artifact_id.notin_(exclude_ids))
        # oversample chunks — many can share one parent, and we dedupe to k below.
        cstmt = cstmt.where(cdist <= max_distance).order_by(cdist).limit(k * 5)
        for aid, text_, dist in (await db.execute(cstmt)).all():
            sim = 1.0 - float(dist)
            if sim > best.get(aid, -1.0):
                best[aid] = sim
                snippet[aid] = text_
    else:
        # SQLite: no vector index — score in Python over the workspace's embedded rows.
        floor = 1.0 - max_distance
        astmt = select(Artifact).where(Artifact.workspace_id == ws, Artifact.embedding.isnot(None))
        if sources:
            astmt = astmt.where(Artifact.source.in_(sources))
        if exclude_ids:
            astmt = astmt.where(Artifact.id.notin_(exclude_ids))
        for a in (await db.execute(astmt)).scalars().all():
            arts[a.id] = a
            if a.embedding:
                s = embeddings.cosine(query_vector, a.embedding)
                if s >= floor:
                    best[a.id] = s
        cstmt = select(ArtifactChunk).where(ArtifactChunk.workspace_id == ws, ArtifactChunk.embedding.isnot(None))
        if sources:
            cstmt = cstmt.where(ArtifactChunk.source.in_(sources))
        if exclude_ids:
            cstmt = cstmt.where(ArtifactChunk.artifact_id.notin_(exclude_ids))
        for c in (await db.execute(cstmt)).scalars().all():
            if not c.embedding:
                continue
            s = embeddings.cosine(query_vector, c.embedding)
            if s >= floor and s > best.get(c.artifact_id, -1.0):
                best[c.artifact_id] = s
                snippet[c.artifact_id] = c.text

    missing = [aid for aid in best if aid not in arts]
    if missing:  # parents surfaced only via a chunk — load them
        for a in (
            (await db.execute(select(Artifact).where(Artifact.workspace_id == ws, Artifact.id.in_(missing))))
            .scalars()
            .all()
        ):
            arts[a.id] = a

    out: list[tuple[Artifact, float]] = []
    for aid, sim in sorted(best.items(), key=lambda x: x[1], reverse=True):
        art = arts.get(aid)
        if art is None:
            continue
        if aid in snippet:
            art._hit_snippet = snippet[aid]  # transient: the passage that matched
        out.append((art, sim))
        if len(out) >= k:
            break
    return out


async def resolve_entity(db, ws: str, kind: str, name: str, *, meta: dict | None = None) -> Entity | None:
    """Find-or-create an entity of `kind` by normalized name (a wrong merge is
    worse than a duplicate). Returns None for empty names."""
    norm = normalize_name(name)
    if not norm:
        return None
    rows = (await db.execute(select(Entity).where(Entity.workspace_id == ws, Entity.kind == kind))).scalars().all()
    for e in rows:
        if e.normalized_name == norm or norm in [normalize_name(a) for a in (e.aliases or [])]:
            if meta:
                e.meta = {**(e.meta or {}), **{k: v for k, v in meta.items() if v}}
            e.updated_at = _now()
            return e
    e = Entity(
        id=f"en_{uuid.uuid4().hex[:10]}",
        workspace_id=ws,
        kind=kind,
        name=name.strip()[:200],
        normalized_name=norm,
        aliases=[],
        identifiers={},
        meta={k: v for k, v in (meta or {}).items() if v},
        state="open",
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(e)
    await db.flush()
    return e


def _emails(e: Entity) -> set[str]:
    ids = e.identifiers or {}
    out = {x.lower() for x in (ids.get("emails") or []) if x}
    if (e.meta or {}).get("email"):
        out.add(e.meta["email"].lower())
    return out


def _handles(e: Entity) -> set[str]:
    return {x.lower() for x in ((e.identifiers or {}).get("handles") or []) if x}


def _alias_norms(e: Entity) -> set[str]:
    return {normalize_name(a) for a in (e.aliases or [])}


def _enrich_person(e: Entity, name: str, email: str | None, handle: str | None) -> None:
    """Fold a freshly-seen name/email/handle into a matched person."""
    norm = normalize_name(name)
    if norm and norm != e.normalized_name and norm not in _alias_norms(e):
        e.aliases = [*(e.aliases or []), name.strip()[:200]]
    ids = dict(e.identifiers or {})
    if email and email not in _emails(e):
        ids["emails"] = sorted({*(ids.get("emails") or []), email})
    if handle and handle not in _handles(e):
        ids["handles"] = sorted({*(ids.get("handles") or []), handle})
    e.identifiers = ids
    e.updated_at = _now()


async def merge_person(db, ws: str, keep: Entity, drop: Entity) -> None:
    """Fold `drop` into `keep`: repoint every edge, union identity signals, delete
    `drop`. Only ever called when the two share an email (a safe, unique key)."""
    if keep.id == drop.id:
        return
    links = (
        (
            await db.execute(
                select(Link).where(Link.workspace_id == ws, or_(Link.from_id == drop.id, Link.to_id == drop.id))
            )
        )
        .scalars()
        .all()
    )
    for lk in links:
        new_from = keep.id if lk.from_id == drop.id else lk.from_id
        new_to = keep.id if lk.to_id == drop.id else lk.to_id
        twin = (
            (
                await db.execute(
                    select(Link).where(
                        Link.workspace_id == ws,
                        Link.from_type == lk.from_type,
                        Link.from_id == new_from,
                        Link.to_type == lk.to_type,
                        Link.to_id == new_to,
                        Link.type == lk.type,
                    )
                )
            )
            .scalars()
            .first()
        )
        if twin and twin.id != lk.id:  # keep already has this edge — drop the redundant one
            await db.delete(lk)
        else:
            lk.from_id, lk.to_id = new_from, new_to
    for a in [drop.name, *(drop.aliases or [])]:
        if a and normalize_name(a) != keep.normalized_name and normalize_name(a) not in _alias_norms(keep):
            keep.aliases = [*(keep.aliases or []), a]
    keep.identifiers = {
        **(keep.identifiers or {}),
        "emails": sorted(_emails(keep) | _emails(drop)),
        "handles": sorted(_handles(keep) | _handles(drop)),
    }
    keep.meta = {**(drop.meta or {}), **(keep.meta or {})}
    keep.updated_at = _now()
    await db.delete(drop)
    await db.flush()


async def resolve_person(
    db, ws: str, name: str, *, email: str | None = None, handle: str | None = None
) -> Entity | None:
    """Find-or-create a person, unified across connectors by email (then handle,
    then name). Enriches the match with any new signal; merges legacy duplicates
    that share an email. Returns None when there's nothing to key on."""
    norm = normalize_name(name)
    email = (email or "").strip().lower() or None
    handle = (handle or "").strip().lower() or None
    if not (norm or email or handle):
        return None
    persons = (
        (await db.execute(select(Entity).where(Entity.workspace_id == ws, Entity.kind == "person"))).scalars().all()
    )

    match = None
    if email:  # strong, cross-connector key — collapse any duplicates on it
        owners = [e for e in persons if email in _emails(e)]
        if owners:
            match = owners[0]
            for dup in owners[1:]:
                await merge_person(db, ws, match, dup)
    if match is None and handle:  # e.g. a GitHub login — deterministic per tool
        match = next((e for e in persons if handle in _handles(e)), None)
    if match is None and norm:  # weakest signal; conservative exact/alias match only
        match = next((e for e in persons if e.normalized_name == norm or norm in _alias_norms(e)), None)

    if match is not None:
        _enrich_person(match, name, email, handle)
        return match

    e = Entity(
        id=f"en_{uuid.uuid4().hex[:10]}",
        workspace_id=ws,
        kind="person",
        name=name.strip()[:200],
        normalized_name=norm,
        aliases=[],
        identifiers={
            k: v for k, v in (("emails", [email] if email else None), ("handles", [handle] if handle else None)) if v
        },
        meta={"email": email} if email else {},
        state="open",
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(e)
    await db.flush()
    return e


async def ensure_link(
    db,
    ws: str,
    from_type: str,
    from_id: str,
    to_type: str,
    to_id: str,
    link_type: str,
    *,
    source_artifact_id: str | None = None,
    meta: dict | None = None,
) -> Link:
    """Idempotent typed link between two nodes (entity or artifact)."""
    existing = (
        (
            await db.execute(
                select(Link).where(
                    Link.workspace_id == ws,
                    Link.from_type == from_type,
                    Link.from_id == from_id,
                    Link.to_type == to_type,
                    Link.to_id == to_id,
                    Link.type == link_type,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing:
        if meta:
            existing.meta = {**(existing.meta or {}), **meta}
        return existing
    link = Link(
        id=f"lk_{uuid.uuid4().hex[:10]}",
        workspace_id=ws,
        from_type=from_type,
        from_id=from_id,
        to_type=to_type,
        to_id=to_id,
        type=link_type,
        source_artifact_id=source_artifact_id,
        meta=meta or {},
        created_at=_now(),
    )
    db.add(link)
    await db.flush()
    return link


async def _link_commitment_issue(db, ws: str, commitment: Entity, iss: Artifact, *, via: str) -> None:
    """Record a commitment as fulfilled by a work item (deterministic or vector).
    Writes meta under "work"; "linear" is kept as a legacy alias older rows read."""
    await ensure_link(
        db,
        ws,
        "artifact",
        iss.id,
        "entity",
        commitment.id,
        "fulfills",
        source_artifact_id=iss.id,
        meta={"identifier": iss.external_ref, "url": iss.url, "via": via},
    )
    ref = {"identifier": iss.external_ref, "url": iss.url, "source": iss.source}
    commitment.state = "tracked"
    commitment.meta = {**(commitment.meta or {}), "work": ref, "linear": ref}
    commitment.updated_at = _now()


async def _load_work_items(db, ws: str) -> list[Artifact]:
    """Open work items for commitment matching, loaded once per batch."""
    rows = (
        (await db.execute(select(Artifact).where(Artifact.workspace_id == ws, Artifact.source.in_(WORK_SOURCES))))
        .scalars()
        .all()
    )
    return [i for i in rows if (i.meta or {}).get("stateType") not in ("completed", "canceled")]


async def match_commitment_to_work(db, ws: str, commitment: Entity, issues: list[Artifact] | None = None) -> bool:
    """Link a commitment to the work item that fulfills it — Linear issue,
    GitHub PR or GitHub issue (WORK_SOURCES). Deterministic text match first
    (fast); a native vector pass then catches semantic matches text misses.
    Sets state='tracked'; otherwise leaves it untracked. READ-ONLY w.r.t.
    embeddings — work items are embedded at ingest, so the query vector is the
    only thing computed here and it is never persisted. `issues` may be passed
    pre-loaded so a batch matcher reads the work set once, not once per commitment."""
    if issues is None:
        issues = await _load_work_items(db, ws)
    if not issues:
        return False
    if not issues:
        return False

    for iss in issues:
        if text_match(commitment.name, iss.title):
            await _link_commitment_issue(db, ws, commitment, iss, via="text")
            return True

    if embeddings.available():
        query = await embeddings.embed_query(commitment.name)
        if query:
            results = await search_artifacts(db, ws, query, k=5, sources=list(WORK_SOURCES))
            for iss, _score in results:
                if (iss.meta or {}).get("stateType") in ("completed", "canceled"):
                    continue
                await _link_commitment_issue(db, ws, commitment, iss, via="vector")
                return True
    return False


async def match_open_commitments(db, ws: str) -> int:
    """Re-match every still-open commitment against tracked work (used after a pull).
    Returns how many became tracked."""
    open_commitments = (
        (
            await db.execute(
                select(Entity).where(Entity.workspace_id == ws, Entity.kind == "commitment", Entity.state == "open")
            )
        )
        .scalars()
        .all()
    )
    if not open_commitments:
        return 0
    issues = await _load_work_items(db, ws)  # read the work set ONCE, not per commitment
    matched = 0
    for c in open_commitments:
        if await match_commitment_to_work(db, ws, c, issues):
            matched += 1
    if matched:
        await db.commit()
    return matched


WORK_SOURCES = ("linear-issue", "github-pr", "github-issue")


BOT_NAMES = frozenset(
    {
        "mend renovate",
        "renovate",
        "dependabot",
        "github-actions",
        "polar-sync-app",
        "cloudflare-workers-and-pages",
        "figma",
    }
)


def is_bot(name: str | None) -> bool:
    """Automation accounts must never become people in the company graph."""
    if not name:
        return True
    n = name.strip().lower()
    return n.endswith("[bot]") or n.removesuffix("[bot]").strip() in BOT_NAMES


async def link_work_entities(db, ws: str, artifact: Artifact) -> None:
    """Build the ownership graph from a work item's structured meta (no LLM) —
    identical for every connector because meta uses one key vocabulary:
    Person -assigned_to-> Item, Person -created-> Item, Item -belongs_to->
    Project, Person -works_on-> Project. Idempotent; caller commits."""
    if artifact.source not in WORK_SOURCES:
        return
    m = artifact.meta or {}
    is_gh = artifact.source in ("github-pr", "github-issue")
    assignee_ent = None
    if m.get("assignee") and not is_bot(m.get("assignee")):
        assignee_ent = await resolve_person(
            db,
            ws,
            m["assignee"],
            email=None if is_gh else m.get("assigneeEmail"),
            handle=m["assignee"] if is_gh else None,
        )
        if assignee_ent:
            await ensure_link(
                db,
                ws,
                "entity",
                assignee_ent.id,
                "artifact",
                artifact.id,
                "assigned_to",
                source_artifact_id=artifact.id,
            )
    if m.get("creator") and m.get("creator") != m.get("assignee") and not is_bot(m.get("creator")):
        ce = await resolve_person(db, ws, m["creator"], handle=m["creator"] if is_gh else None)
        if ce:
            await ensure_link(
                db, ws, "entity", ce.id, "artifact", artifact.id, "created", source_artifact_id=artifact.id
            )
    if m.get("project"):
        pr = await resolve_entity(db, ws, "project", m["project"], meta={"state": m.get("projectState")})
        if pr:
            await ensure_link(
                db, ws, "artifact", artifact.id, "entity", pr.id, "belongs_to", source_artifact_id=artifact.id
            )
            if assignee_ent:
                await ensure_link(db, ws, "entity", assignee_ent.id, "entity", pr.id, "works_on")


_MAX_TICKET_LINKS = 10


def ticket_refs(text: str) -> list[str]:
    """Ticket ids (ENG-231, POLAR-88) named anywhere in a piece of text."""
    return list(dict.fromkeys(TICKET_REF.findall(text or "")))


async def link_ticket_refs(db, ws: str, artifact: Artifact) -> None:
    """Link an artifact to the tickets it names — for EVERY connector, so a Slack
    thread, a spec, a call transcript and a PR branch all reach the same ticket,
    and through it the commitment and customer it serves. A branch-derived ref
    (meta.ticketRefs) is a claim to deliver → `implements`; a mention anywhere in
    the text is context → `references`. Idempotent; caller commits."""
    strong = list((artifact.meta or {}).get("ticketRefs") or [])
    weak = [r for r in ticket_refs(artifact.content or "") if r not in strong]
    for ref in (strong + weak)[:_MAX_TICKET_LINKS]:
        ticket = (
            (
                await db.execute(
                    select(Artifact).where(
                        Artifact.workspace_id == ws, Artifact.source == "linear-issue", Artifact.external_ref == ref
                    )
                )
            )
            .scalars()
            .first()
        )
        if ticket and ticket.id != artifact.id:
            await ensure_link(
                db,
                ws,
                "artifact",
                artifact.id,
                "artifact",
                ticket.id,
                "implements" if ref in strong else "references",
                source_artifact_id=artifact.id,
            )


# Few, strong edges: the similarity floor is retrieval's (_SEMANTIC_THRESHOLD) and
# every link stores its score, so consumers can filter tighter without a re-link.
_NEIGHBOURS = 3


async def link_semantic_neighbours(db, ws: str, artifact: Artifact) -> None:
    """Meaning-based edges: connect this artifact to whatever it is actually about,
    whether or not anyone typed an id. A Slack thread about "the bulk import script"
    reaches the ticket, the spec and the PR that share its meaning.

    The neighbourhood is REPLACED on every pass, not appended: as memory grows a
    closer item can displace an older neighbour, so the graph keeps re-arranging
    itself instead of freezing at whatever existed on the day of ingest."""
    if not artifact.embedding:
        return
    hits = await search_artifacts(db, ws, artifact.embedding, k=_NEIGHBOURS, exclude_ids=[artifact.id])
    await db.execute(
        delete(Link).where(
            Link.workspace_id == ws,
            Link.from_type == "artifact",
            Link.from_id == artifact.id,
            Link.type == "relates_to",
        )
    )
    for other, similarity in hits:
        await ensure_link(
            db,
            ws,
            "artifact",
            artifact.id,
            "artifact",
            other.id,
            "relates_to",
            source_artifact_id=artifact.id,
            meta={"similarity": round(similarity, 3)},
        )


async def update_graph_for(db, ws: str, artifact: Artifact) -> None:
    """Everything the graph learns from one artifact. Shared by first ingest and
    every refresh, so no connector drifts from the others: who owns it, the tickets
    it explicitly claims, and what it means (its nearest memories)."""
    await link_work_entities(db, ws, artifact)
    await link_ticket_refs(db, ws, artifact)
    await link_semantic_neighbours(db, ws, artifact)


async def build_from_artifact(db, ws: str, artifact: Artifact) -> None:
    """Resolve the entities and links implied by one artifact's extraction, then
    try to match any new commitments to Linear. Commits once at the end."""
    ex = artifact.extracted or {}

    # Deterministic graph from the artifact's structured fields (all connectors).
    await update_graph_for(db, ws, artifact)

    customer_ents: dict[str, Entity] = {}
    for ent in ex.get("entities", []) or []:
        name, kind = (ent or {}).get("name", ""), (ent or {}).get("kind", "")
        if not name:
            continue
        if kind == "customer":
            c = await resolve_entity(db, ws, "customer", name)
            if c:
                customer_ents[normalize_name(name)] = c
                await ensure_link(
                    db, ws, "artifact", artifact.id, "entity", c.id, "mentions", source_artifact_id=artifact.id
                )
        elif kind == "person":
            p = await resolve_person(db, ws, name)
            if p:
                await ensure_link(
                    db, ws, "artifact", artifact.id, "entity", p.id, "mentions", source_artifact_id=artifact.id
                )

    # Note-takers carry structured attendees with emails — the strongest signal
    # for unifying a person across tools (an attendee email ties back to a Linear
    # assignee email). Circleback: [{name,email}]; Fireflies: [email, …].
    if artifact.source in ("circleback", "fireflies"):
        m = artifact.meta or {}
        attendees = [(a.get("name"), a.get("email")) for a in m.get("attendees", []) or []]
        attendees += [(None, em) for em in m.get("participants", []) or [] if isinstance(em, str) and "@" in em]
        for nm, em in attendees:
            if (nm or em) and not (nm and is_bot(nm)):
                p = await resolve_person(db, ws, nm or em, email=em)
                if p:
                    await ensure_link(
                        db, ws, "artifact", artifact.id, "entity", p.id, "mentions", source_artifact_id=artifact.id
                    )

    primary_customer = next(iter(customer_ents.values()), None)

    for c in ex.get("commitments", []) or []:
        text = (c or {}).get("text", "")
        if not text:
            continue
        ce = await resolve_entity(db, ws, "commitment", text, meta={"to": c.get("to", ""), "due": c.get("due", "")})
        if not ce:
            continue
        await ensure_link(db, ws, "artifact", artifact.id, "entity", ce.id, "source_of", source_artifact_id=artifact.id)
        to_name = c.get("to", "")
        cust = customer_ents.get(normalize_name(to_name)) if to_name else None
        if to_name and not cust:
            cust = await resolve_entity(db, ws, "customer", to_name)
        cust = cust or primary_customer
        if cust:
            await ensure_link(db, ws, "entity", ce.id, "entity", cust.id, "made_to")
        if ce.state == "open":
            await match_commitment_to_work(db, ws, ce)

    for req in ex.get("requests", []) or []:
        if not req:
            continue
        fe = await resolve_entity(db, ws, "feature", req)
        if not fe:
            continue
        await ensure_link(db, ws, "artifact", artifact.id, "entity", fe.id, "source_of", source_artifact_id=artifact.id)
        for cust in customer_ents.values():
            await ensure_link(db, ws, "entity", fe.id, "entity", cust.id, "requested_by")

    # Decisions become first-class memory (the institutional 'why'). A brand-new
    # one is checked once against prior decisions for a reversal — best-effort, so
    # it can never affect the rest of ingestion.
    for dec in ex.get("decisions", []) or []:
        if not dec:
            continue
        de = await resolve_entity(db, ws, "decision", dec)
        if not de:
            continue
        await ensure_link(db, ws, "artifact", artifact.id, "entity", de.id, "source_of", source_artifact_id=artifact.id)
        if de.state == "open" and not (de.meta or {}).get("conflictChecked"):
            await _flag_decision_conflict(db, ws, de)

    await db.commit()


async def _flag_decision_conflict(db, ws: str, new_decision: Entity) -> None:
    """Judge a new decision against the topically-nearest prior decision and, if it
    reverses one, record a `supersedes` marker the detector reads. Fully guarded:
    any failure leaves ingestion untouched and simply retries on a later sync."""
    try:
        others = (
            (
                await db.execute(
                    select(Entity).where(
                        Entity.workspace_id == ws, Entity.kind == "decision", Entity.id != new_decision.id
                    )
                )
            )
            .scalars()
            .all()
        )
        q = _tokens(new_decision.name)
        candidate, best = None, 1
        for o in others:
            if o.state != "open":
                continue
            overlap = len(q & _tokens(o.name))
            if overlap > best:
                candidate, best = o, overlap
        if candidate is None:
            return

        from ..agents.definitions import SYSTEM_PROMPTS, build_agent
        from ..agents.schemas import DecisionConflict

        agent = build_agent(SYSTEM_PROMPTS["decision-judge"], DecisionConflict)
        prompt = f'EARLIER DECISION: "{candidate.name}"\n\nNEW DECISION: "{new_decision.name}"'
        verdict = (await agent.run(prompt)).output
        new_decision.meta = {**(new_decision.meta or {}), "conflictChecked": True}
        if verdict.contradicts:
            new_decision.meta = {
                **new_decision.meta,
                "supersedes": {"id": candidate.id, "reason": verdict.reason},
            }
            await ensure_link(db, ws, "entity", new_decision.id, "entity", candidate.id, "supersedes")
        new_decision.updated_at = _now()
        await db.flush()
    except Exception:
        logger.warning("decision-conflict check skipped", exc_info=True)


async def traverse(
    db, ws: str, start_ids: list[str], depth: int = 2, edge_types: list[str] | None = None
) -> list[Link]:
    """BFS over the graph up to `depth` hops from the start set; returns the
    edges reached. Python-side scan — swap for a recursive CTE at real scale;
    every caller goes through this seam."""
    frontier: set[str] = set(start_ids)
    visited: set[str] = set(frontier)
    edges: dict[str, Link] = {}
    for _ in range(max(1, depth)):
        if not frontier:
            break
        stmt = select(Link).where(Link.workspace_id == ws, or_(Link.from_id.in_(frontier), Link.to_id.in_(frontier)))
        if edge_types:
            stmt = stmt.where(Link.type.in_(edge_types))
        rows = (await db.execute(stmt)).scalars().all()
        nxt: set[str] = set()
        for lk in rows:
            edges[lk.id] = lk
            for nid in (lk.from_id, lk.to_id):
                if nid not in visited:
                    visited.add(nid)
                    nxt.add(nid)
        frontier = nxt
    return list(edges.values())


async def neighbors(db, ws: str, entity_id: str) -> list[Link]:
    """All links touching an entity (either direction)."""
    return (
        (
            await db.execute(
                select(Link).where(Link.workspace_id == ws, or_(Link.from_id == entity_id, Link.to_id == entity_id))
            )
        )
        .scalars()
        .all()
    )
