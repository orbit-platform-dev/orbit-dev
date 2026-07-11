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
    customer_id: str | None = None
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
    customer_id: str | None = None
    revenue_impact: float
    owner: dict[str, Any]
    team: list[Any] = []
    tags: list[str] = []
    documents: list[Any] = []
    prd: dict[str, Any] | None = None
    crm_update: dict[str, Any] | None = None
    engineering: dict[str, Any] | None = None
    design: dict[str, Any] | None = None
    qa: dict[str, Any] | None = None
    sales: dict[str, Any] | None = None
    customer_update: dict[str, Any] | None = None
    timeline: dict[str, Any] | None = None
    internal_notes: str | None = None
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


class CustomerOut(CamelModel):
    id: str
    name: str
    domains: list[str] = []
    aliases: list[str] = []
    created_at: datetime
    meeting_count: int = 0
    plan_count: int = 0
    approved_plan_count: int = 0
    open_commitments: int = 0
    last_meeting_at: datetime | None = None


class KnowledgeItemOut(CamelModel):
    id: str
    customer_id: str
    kind: str
    title: str
    content: dict[str, Any] = {}
    status: str
    source_meeting_id: str | None = None
    source_plan_id: str | None = None
    approved_at: datetime | None = None
    created_at: datetime


class SyncJobOut(CamelModel):
    id: str
    plan_id: str
    customer_id: str | None = None
    kind: str
    destination: str
    status: str
    payload: dict[str, Any] = {}
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class InsightOut(CamelModel):
    id: str
    customer_id: str | None = None
    kind: str
    title: str
    detail: str = ""
    evidence: dict[str, Any] = {}
    status: str
    created_at: datetime


class GoalOut(CamelModel):
    id: str
    title: str
    detail: str = ""
    target_date: datetime | None = None
    status: str
    created_at: datetime


class UploadMeetingIn(CamelModel):
    title: str
    source: str = "upload"
    account: str = "Unknown account"
    transcript_text: str | None = None


class RunTranscriptIn(CamelModel):
    transcript: str
    title: str = "Pasted transcript"
    account: str = "Manual upload"
    # Signal kind: a conversation transcript or a company document.
    source: str = "transcript"
