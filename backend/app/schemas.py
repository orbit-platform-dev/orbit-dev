"""Pydantic response schemas — the MVP surface.

Field names are snake_case (Pythonic) but serialize to camelCase via an alias
generator, so responses match the frontend's TypeScript types exactly.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


# --- Memory (artifacts) -----------------------------------------------------
class ArtifactOut(CamelModel):
    id: str
    source: str
    kind: str
    external_ref: str | None = None
    url: str | None = None
    title: str
    content: str = ""
    extracted: dict[str, Any] | None = None
    status: str
    occurred_at: datetime
    created_at: datetime


# --- Company model (entities) -----------------------------------------------
class EntityOut(CamelModel):
    id: str
    kind: str
    name: str
    state: str
    meta: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime


class LinkedArtifactOut(CamelModel):
    type: str
    artifact: ArtifactOut


class LinkedEntityOut(CamelModel):
    type: str
    entity: EntityOut


class MemoryFactOut(CamelModel):
    id: str
    fact: str
    kind: str
    confidence: float
    status: str
    source_ref: str = ""
    source_artifact_id: str | None = None


class EntityDetailOut(CamelModel):
    entity: EntityOut
    artifacts: list[LinkedArtifactOut] = []
    related_entities: list[LinkedEntityOut] = []
    facts: list[MemoryFactOut] = []


# --- Feed (findings + brief) ------------------------------------------------
class FindingOut(CamelModel):
    id: str
    kind: str  # gap | drift | trend | win
    title: str
    detail: str = ""
    status: str  # open | approved | dismissed | resolved
    action: dict[str, Any] | None = None
    # An autonomously drafted, human-reviewable proposal (PRD update / Slack
    # alert / action plan) attached by the ProductAgent to a high-priority finding.
    proposal: dict[str, Any] | None = None
    entities: list[EntityOut] = []
    artifacts: list[ArtifactOut] = []
    created_at: datetime


class BriefOut(CamelModel):
    id: str
    title: str = ""
    detail: str = ""
    evidence: dict[str, Any] = {}
    created_at: datetime


class FeedOut(CamelModel):
    brief: BriefOut | None = None
    findings: list[FindingOut] = []


class CorrectionOut(CamelModel):
    id: str
    section: str
    field: str
    before: str = ""
    after: str = ""
    created_at: datetime


# --- Intent (goals) ---------------------------------------------------------
class GoalOut(CamelModel):
    id: str
    title: str
    detail: str = ""
    target_date: datetime | None = None
    status: str
    created_at: datetime


# --- Connectors -------------------------------------------------------------
class IntegrationOut(CamelModel):
    key: str
    name: str
    category: str
    description: str
    status: str
    last_sync: datetime | None = None
    account: str | None = None
    stats: list[Any] | None = None
    # connectable: Orbit has a real connector for this key (Linear, Slack).
    # oauth_available: that connector's server-side OAuth is configured, so the
    # one-click button can appear (else API-key fallback / coming soon).
    connectable: bool = False
    oauth_available: bool = False
