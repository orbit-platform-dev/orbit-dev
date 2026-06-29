"""Pydantic response schemas.

Field names are snake_case (Pythonic) but serialize to camelCase via an alias
generator, so responses match the frontend's TypeScript types in src/lib/types.ts
exactly. Rich nested structures are passed through as already-camelCase JSON.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class MemberOut(CamelModel):
    id: str
    name: str
    email: str
    role: str
    title: str
    status: str
    avatar_url: str | None = None


class MeetingOut(CamelModel):
    id: str
    title: str
    source: str
    status: str
    account: str
    date: datetime
    duration_sec: int
    analysis_progress: int
    linked_project_id: str | None = None
    participants: list[Any] = []
    transcript: list[Any] = []
    analysis: dict[str, Any] | None = None
    tags: list[str] = []


class AgentOut(CamelModel):
    key: str
    name: str
    role: str
    description: str
    model: str
    status: str
    current_thought: str | None = None
    confidence: int
    execution_time_sec: int
    completed_tasks: int
    color: str
    documents: list[Any] = []
    recent_runs: list[Any] = []


class ProjectOut(CamelModel):
    id: str
    name: str
    key: str
    description: str
    status: str
    health: str
    progress: int
    start_date: datetime
    target_date: datetime
    delivery_estimate: str
    source_meeting_id: str | None = None
    revenue_impact: float
    owner: dict[str, Any]
    team: list[Any] = []
    tags: list[str] = []
    documents: list[Any] = []
    prd: dict[str, Any] | None = None
    engineering: dict[str, Any] | None = None
    design: dict[str, Any] | None = None
    qa: dict[str, Any] | None = None
    sales: dict[str, Any] | None = None
    customer_update: dict[str, Any] | None = None
    timeline: dict[str, Any] | None = None
    approval_status: str = "draft"
    approved_at: datetime | None = None


class TaskOut(CamelModel):
    id: str
    key: str
    title: str
    description: str
    column: str
    priority: str
    discipline: str
    estimate: int | None = None
    project_id: str | None = None
    assignee: dict[str, Any] | None = None
    labels: list[str] = []
    links: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime


class GraphNodeOut(CamelModel):
    id: str
    kind: str
    title: str
    subtitle: str
    status: str
    agent: str | None = None
    progress: int
    owner: str | None = None
    project_id: str | None = None
    meta: dict[str, Any] = {}
    history: list[Any] = []


class GraphEdgeOut(CamelModel):
    id: str
    source: str
    target: str
    animated: bool
    label: str | None = None


class GraphOut(CamelModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]


class TimelineEventOut(CamelModel):
    id: str
    kind: str
    title: str
    description: str
    at: datetime
    actor: str
    agent: str | None = None
    project_id: str | None = None
    meeting_id: str | None = None
    meta: dict[str, Any] | None = None


class IntegrationOut(CamelModel):
    key: str
    name: str
    category: str
    description: str
    status: str
    last_sync: datetime | None = None
    account: str | None = None
    stats: list[Any] | None = None


class ActivityEventOut(CamelModel):
    id: str
    actor: dict[str, Any]
    action: str
    target: str
    target_type: str
    at: datetime
    project_id: str | None = None


class UploadMeetingIn(CamelModel):
    title: str
    source: str = "upload"
    account: str = "Unknown account"
    transcript_text: str | None = None


class RunTranscriptIn(CamelModel):
    transcript: str
    title: str = "Pasted transcript"
    account: str = "Manual upload"
