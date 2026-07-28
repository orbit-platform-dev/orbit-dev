"""SQLAlchemy ORM models — the MVP data model.

The AI Operating System loop stores: observed memory (Artifact), the company
model (Entity + Link), intent (Goal), findings/recommendations (Insight), the
learning signal (Feedback), connectors (Integration), and a light audit trail
(ActivityEvent). Rich nested data lives in JSON columns so the schema stays
portable across SQLite (dev) and PostgreSQL (prod).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

EMBEDDING_DIM = 768


def _embedding_column():
    """A real pgvector column on Postgres (indexable), plain JSON on SQLite.

    none_as_null=True is load-bearing: without it SQLAlchemy stores a Python
    None in a JSON column as the JSON literal ``null`` (not SQL NULL), so
    ``embedding IS NULL`` would MISS un-embedded rows on SQLite — breaking the
    backfill query and the read-only retrieval filter. On Postgres the variant
    is a real Vector, which stores None as SQL NULL anyway."""
    return mapped_column(
        JSON(none_as_null=True).with_variant(Vector(EMBEDDING_DIM), "postgresql"),
        nullable=True,
    )


class Workspace(Base):
    """Tenant boundary. Every business row carries a workspace_id; dev/demo runs
    on the seeded default workspace until Clerk orgs are wired."""

    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    auto_sync: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    embedding_model: Mapped[str | None] = mapped_column(String, nullable=True)
    # Chat credits each NEW member starts with: raising it lifts the whole tenant,
    # while one person is topped up on their own user_credits row.
    credit_default: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default=text("5"))
    # SHA-256 of this workspace's MCP key. The key IS the tenant credential:
    # /mcp resolves the workspace from it and trusts no client-supplied header.
    mcp_key_hash: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class Artifact(Base):
    """Unified observed memory (Observe + Remember). Every ingested item from any
    source — a customer call or a Linear issue — with provenance (source,
    external_ref, url), time, the Extractor's structured output, source-specific
    meta (e.g. Linear issue state), and an embedding for semantic retrieval."""

    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    source: Mapped[str] = mapped_column(String, index=True)  # call | linear-issue | document
    kind: Mapped[str] = mapped_column(String, default="")  # call | issue | doc
    external_ref: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text, default="")
    extracted: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="observed")  # observed | extracted | failed
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    embedding: Mapped[list[float] | None] = _embedding_column()


class ArtifactChunk(Base):
    """One embedded slice of a long artifact's content, so semantic search can
    match a passage buried deep in a document — not just its opening. Short
    artifacts get NO chunks (their own embedding covers them), so most items
    (issues, PRs, threads) create zero rows. `source` mirrors the parent so a
    source-filtered search needs no join; the parent link cascades on delete.
    Rows are rebuilt whenever the parent's content changes (see _write_chunks)."""

    __tablename__ = "artifact_chunks"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    artifact_id: Mapped[str] = mapped_column(String, ForeignKey("artifacts.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    embedding: Mapped[list[float] | None] = _embedding_column()


class Entity(Base):
    """A node in the company model (Understand) — customer, commitment, feature
    request, person or goal — resolved from artifacts. `state` tracks lifecycle
    (a commitment goes open → tracked → delivered); `meta` holds kind-specific
    fields (to, due, the fulfilling Linear ref)."""

    __tablename__ = "entities"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    kind: Mapped[str] = mapped_column(String, index=True)  # customer | commitment | feature | person | goal
    name: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    identifiers: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    state: Mapped[str] = mapped_column(String, default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Link(Base):
    """A typed, provenance-backed relationship in the company model. Endpoints
    are entities OR artifacts (from_type/to_type), so a commitment can point to
    the call that made it (source_of) and the Linear issue that fulfills it
    (fulfills). types: source_of | made_to | requested_by | fulfills | mentions."""

    __tablename__ = "links"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    from_type: Mapped[str] = mapped_column(String)  # entity | artifact
    from_id: Mapped[str] = mapped_column(String, index=True)
    to_type: Mapped[str] = mapped_column(String)  # entity | artifact
    to_id: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String)
    source_artifact_id: Mapped[str | None] = mapped_column(String, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Insight(Base):
    """A finding or recommendation over the company model (Reason + Recommend).
    kind: gap | drift | trend | win | brief. status: open | approved | dismissed
    | resolved. Evidence is entity/artifact ids; `action` carries a prepared,
    approvable Linear write; `dedupe_key` dedups by entity/condition."""

    __tablename__ = "insights"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    origin: Mapped[str] = mapped_column(String, default="model", server_default="model")
    entity_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    artifact_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    action: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class Goal(Base):
    """A declared company intention — the reference signal reasoning compares
    reality against. Minimal by design: a sentence, optionally a date."""

    __tablename__ = "goals"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    title: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text, default="")
    target_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")  # open | achieved | dropped
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Feedback(Base):
    """One human correction (an edit or dismissal) — the learning signal, and the
    company's permanent repository of behavioral preferences & rules. `embedding`
    vectorizes the correction so the most RELEVANT past rules (not just the most
    recent) can be retrieved for the task at hand and injected into generation."""

    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    plan_id: Mapped[str | None] = mapped_column(String, nullable=True)
    section: Mapped[str] = mapped_column(String, index=True)  # finding | ...
    field: Mapped[str] = mapped_column(String)
    before: Mapped[str] = mapped_column(Text, default="")
    after: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    embedding: Mapped[list[float] | None] = _embedding_column()


class Integration(Base):
    """A connector row, scoped to ONE workspace (tenant). `credentials` holds the
    API key / OAuth token and is NEVER exposed through the API. The composite key
    (workspace_id, key) is what isolates one company's connections from another's."""

    __tablename__ = "integrations"
    workspace_id: Mapped[str] = mapped_column(
        String, primary_key=True, default="ws_default", server_default="ws_default"
    )
    key: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    account: Mapped[str | None] = mapped_column(String, nullable=True)
    stats: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    credentials: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    sync_state: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class ActivityEvent(Base):
    """A light audit trail of what Orbit and humans did (scans, approvals)."""

    __tablename__ = "activity_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor: Mapped[dict[str, Any]] = mapped_column(JSON)
    action: Mapped[str] = mapped_column(String)
    target: Mapped[str] = mapped_column(String)
    target_type: Mapped[str] = mapped_column(String)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    meeting_id: Mapped[str | None] = mapped_column(String, nullable=True)


class ChatConversation(Base):
    """An Ask-Orbit conversation, PRIVATE to one user. Scoped to (workspace_id,
    user_id) so it is never shared with others in the same workspace. Messages
    are a JSON list of {role, content, citations, grounded}."""

    __tablename__ = "chat_conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", index=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String, default="New chat")
    messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class McpQuery(Base):
    """One external-agent question asked through the MCP surface (Observe).
    Logged so the reasoner can spot repeated questions memory could NOT answer
    (hits == 0) — every MCP consumer becomes a sensor for what the company's
    memory is missing. Query text only; no results are stored."""

    __tablename__ = "mcp_queries"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default", index=True)
    tool: Mapped[str] = mapped_column(String)
    query: Mapped[str] = mapped_column(Text, default="")
    hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class UserCredit(Base):
    """One person's chat allowance in a workspace (beta metering). Balance is
    `granted - used`, one credit per answered question. Keyed per (workspace, user)
    so one teammate running out never blocks the team; `requested_at` holds their
    last top-up request and rate-limits the next one."""

    __tablename__ = "user_credits"
    workspace_id: Mapped[str] = mapped_column(String, primary_key=True, default="ws_default")
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    granted: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserVisit(Base):
    """One person's Feed visit window, powering the login briefing's 'while you
    were away' delta. `seen_at` is the last fetch; `anchor_at` is where the delta
    window starts — it only advances when a NEW session begins (last fetch older
    than the session gap), so refreshing the page never erases the delta."""

    __tablename__ = "user_visits"
    workspace_id: Mapped[str] = mapped_column(String, primary_key=True, default="ws_default")
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    anchor_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Memory(Base):
    """A distilled company FACT with confidence + lifecycle (Phase 3). Facts are
    derived from artifacts (their extraction + structured meta), deduplicated by
    embedding, and updated as reality changes: a contradicting fact SUPERSEDES the
    old one (never deletes it), so history stays queryable. `subject` is the slot
    a fact is 'about' (an issue/project) — one active fact per (subject, kind).
    Retrieval (Phase 4) ranks by semantic similarity + confidence + recency."""

    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", index=True)
    fact: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(
        String, default="fact", index=True
    )  # assignment|ownership|decision|blocker|deadline|status|context
    subject: Mapped[str] = mapped_column(
        String, default="", index=True
    )  # normalized slot key (issue/project) for contradiction detection
    subject_entity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[float] = mapped_column(default=0.7)
    importance: Mapped[float] = mapped_column(default=0.5)
    status: Mapped[str] = mapped_column(String, default="active", index=True)  # active | stale | superseded
    source_artifact_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_ref: Mapped[str] = mapped_column(String, default="")
    superseded_by: Mapped[str | None] = mapped_column(String, nullable=True)
    history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    last_verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    embedding: Mapped[list[float] | None] = _embedding_column()
