"""SQLAlchemy ORM models.

Rich nested structures (transcripts, analyses, plans) are stored as JSON columns
so the schema stays portable across SQLite (dev) and PostgreSQL (prod) while the
relational columns carry the queryable fields (status, account, dates, impact).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


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
    account: Mapped[str] = mapped_column(String)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    analysis_progress: Mapped[int] = mapped_column(Integer, default=0)
    linked_project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    participants: Mapped[list[Any]] = mapped_column(JSON, default=list)
    transcript: Mapped[list[Any]] = mapped_column(JSON, default=list)
    analysis: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)


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


class Project(Base):
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
    revenue_impact: Mapped[float] = mapped_column(Float, default=0)
    owner: Mapped[dict[str, Any]] = mapped_column(JSON)
    team: Mapped[list[Any]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    documents: Mapped[list[Any]] = mapped_column(JSON, default=list)
    prd: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    engineering: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    design: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    qa: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    sales: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    customer_update: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timeline: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    approval_status: Mapped[str] = mapped_column(String, default="draft")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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


class ActivityEvent(Base):
    __tablename__ = "activity_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor: Mapped[dict[str, Any]] = mapped_column(JSON)
    action: Mapped[str] = mapped_column(String)
    target: Mapped[str] = mapped_column(String)
    target_type: Mapped[str] = mapped_column(String)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
