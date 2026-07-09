"""SQLAlchemy ORM models.

Rich nested structures (transcripts, analyses, plans) are stored as JSON columns
so the schema stays portable across SQLite (dev) and PostgreSQL (prod) while the
relational columns carry the queryable fields (status, account, dates, impact).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

# Embedding dimension (Gemini text-embedding-004). Changing providers to a
# different dimension requires a migration that rebuilds the vector columns.
EMBEDDING_DIM = 768

# Semantic embedding for Context Engine retrieval: a real pgvector column on
# Postgres (indexable similarity search), plain JSON on dev SQLite (ranked in
# Python — same behavior, no index).
def _embedding_column():
    return mapped_column(JSON().with_variant(Vector(EMBEDDING_DIM), "postgresql"), nullable=True)


class Workspace(Base):
    """Tenant boundary. Every business row carries a workspace_id; the dev/demo
    instance runs on the seeded default workspace until Clerk orgs are wired."""

    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Customer(Base):
    """A real customer entity — meetings, execution plans and knowledge hang off
    it. `normalized_name` + `aliases` + `domains` are the identity-resolution
    keys (see services/customers.py); `name` is the display form."""

    __tablename__ = "customers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    name: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    domains: Mapped[list[str]] = mapped_column(JSON, default=list)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Member(Base):
    __tablename__ = "members"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="active")
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    # `account` stays as the display string (mirrors Customer.name) for UI
    # backcompat; `customer_id` is the real relationship.
    account: Mapped[str] = mapped_column(String)
    customer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    analysis_progress: Mapped[int] = mapped_column(Integer, default=0)
    linked_project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    participants: Mapped[list[Any]] = mapped_column(JSON, default=list)
    transcript: Mapped[list[Any]] = mapped_column(JSON, default=list)
    analysis: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    embedding: Mapped[list[float] | None] = _embedding_column()


class Agent(Base):
    __tablename__ = "agents"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="idle")
    current_thought: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    execution_time_sec: Mapped[int] = mapped_column(Integer, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer, default=0)
    color: Mapped[str] = mapped_column(String, default="#6366f1")
    documents: Mapped[list[Any]] = mapped_column(JSON, default=list)
    recent_runs: Mapped[list[Any]] = mapped_column(JSON, default=list)


class ExecutionPlan(Base):
    """Orbit's central business object: the complete, reviewable execution
    package prepared from one meeting (+ customer context). Table stays
    `projects` for backward compatibility with existing data and the
    `/projects` API surface."""

    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    key: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String)
    health: Mapped[str] = mapped_column(String)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    target_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delivery_estimate: Mapped[str] = mapped_column(String)
    source_meeting_id: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    revenue_impact: Mapped[float] = mapped_column(Float, default=0)
    owner: Mapped[dict[str, Any]] = mapped_column(JSON)
    team: Mapped[list[Any]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    documents: Mapped[list[Any]] = mapped_column(JSON, default=list)
    prd: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    crm_update: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    engineering: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    design: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    qa: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    sales: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    customer_update: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timeline: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_status: Mapped[str] = mapped_column(String, default="draft")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# Backward-compatible alias — existing code imports Project.
Project = ExecutionPlan


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    key: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    column: Mapped[str] = mapped_column(String)
    priority: Mapped[str] = mapped_column(String)
    discipline: Mapped[str] = mapped_column(String)
    estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    assignee: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    labels: Mapped[list[str]] = mapped_column(JSON, default=list)
    links: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class GraphNode(Base):
    __tablename__ = "graph_nodes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    subtitle: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    agent: Mapped[str | None] = mapped_column(String, nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    owner: Mapped[str | None] = mapped_column(String, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    history: Mapped[list[Any]] = mapped_column(JSON, default=list)


class GraphEdge(Base):
    __tablename__ = "graph_edges"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String, ForeignKey("graph_nodes.id"))
    target: Mapped[str] = mapped_column(String, ForeignKey("graph_nodes.id"))
    animated: Mapped[bool] = mapped_column(default=False)
    label: Mapped[str | None] = mapped_column(String, nullable=True)


class TimelineEvent(Base):
    __tablename__ = "timeline_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    actor: Mapped[str] = mapped_column(String)
    agent: Mapped[str | None] = mapped_column(String, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    meeting_id: Mapped[str | None] = mapped_column(String, nullable=True)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class Integration(Base):
    __tablename__ = "integrations"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    account: Mapped[str | None] = mapped_column(String, nullable=True)
    stats: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)


class CalendarConnection(Base):
    """An OAuth'd calendar account (one per provider for the MVP workspace)."""

    __tablename__ = "calendar_connections"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # provider key, e.g. "google"
    email: Mapped[str] = mapped_column(String, default="")
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="")
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Approval(Base):
    """Audit record of one approval: who approved which plan, when, and a
    snapshot of the section keys that were approved."""

    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    plan_id: Mapped[str] = mapped_column(String, index=True)
    meeting_id: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    approved_by: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sections: Mapped[list[str]] = mapped_column(JSON, default=list)


class KnowledgeItem(Base):
    """Long-term customer knowledge. Written ONLY from approved artifacts —
    never raw AI output. `kind`: meeting-summary | crm-update | prd | timeline |
    follow-up-email | commitment. Commitments carry status open|completed."""

    __tablename__ = "knowledge_items"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    customer_id: Mapped[str] = mapped_column(String, index=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="active")  # active | open | completed
    source_meeting_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_plan_id: Mapped[str | None] = mapped_column(String, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    embedding: Mapped[list[float] | None] = _embedding_column()


class SyncJob(Base):
    """One outbound synchronization prepared at approval time and executed
    after it — never before. status: pending | running | done | failed | skipped."""

    __tablename__ = "sync_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    plan_id: Mapped[str] = mapped_column(String, index=True)
    customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    kind: Mapped[str] = mapped_column(String)  # crm-update | publish-prd | create-tasks | send-email
    destination: Mapped[str] = mapped_column(String)  # salesforce | notion | jira | email | ...
    status: Mapped[str] = mapped_column(String, default="pending")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChatConversation(Base):
    """One Ask-Orbit conversation (like a Claude/GPT chat). Messages are the
    full transcript [{role, content, at, sources?}]; the customer binding makes
    every later turn retrieve that customer's context automatically."""

    __tablename__ = "chat_conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String, default="ws_default", server_default="ws_default")
    customer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String, default="New conversation")
    messages: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ActivityEvent(Base):
    __tablename__ = "activity_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor: Mapped[dict[str, Any]] = mapped_column(JSON)
    action: Mapped[str] = mapped_column(String)
    target: Mapped[str] = mapped_column(String)
    target_type: Mapped[str] = mapped_column(String)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Ties the row to its meeting so deleting the meeting removes its activity.
    meeting_id: Mapped[str | None] = mapped_column(String, nullable=True)
