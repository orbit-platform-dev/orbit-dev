"""Structured outputs for the two MVP agents (Extractor + Reasoner).

Each agent returns a typed Pydantic object (enforced via constrained decoding)
that serializes to camelCase for the frontend.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Extractor: structures any artifact into company memory ------------------
class ExtractedCommitment(_Camel):
    text: str = Field(description="what was promised")
    to: str = Field(default="", description="who it was promised to (customer/person), if stated")
    due: str = Field(default="", description="when it's due, if stated (e.g. 'before Oct renewal')")


class ExtractedEntity(_Camel):
    name: str
    kind: str = Field(description="customer | person | feature | project")


class ArtifactExtraction(_Camel):
    """The Extractor's structured read of one artifact (a call or a work item).
    Everything is grounded in the artifact; absent things are left out."""

    summary: str = Field(default="", description="one or two crisp sentences")
    commitments: list[ExtractedCommitment] = Field(default_factory=list)
    requests: list[str] = Field(default_factory=list, description="customer/feature requests raised")
    decisions: list[str] = Field(default_factory=list, description="decisions made")
    status: str = Field(default="", description="current status, for work-item artifacts")
    entities: list[ExtractedEntity] = Field(default_factory=list)


# --- Reasoner: recommendation drafting + the company brief ------------------
class DraftedIssue(_Camel):
    """A Linear issue drafted by the Reasoner from a commitment, in the team's style."""

    title: str = Field(description="concise, specific issue title")
    description: str = Field(default="", description="short description grounded in the commitment")


class IntelligenceBrief(_Camel):
    """The periodic company brief — what leadership should know right now."""

    headline: str = Field(description="one sharp sentence on the company's current state")
    summary: str = Field(description="2-4 sentences: what happened, what it means")
    risks: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
