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


class DraftedProposal(_Camel):
    """A concrete, human-reviewable proposal the Product Agent drafts from a
    detected gap/drift — a PRD update, a Slack alert, or an action plan."""

    kind: str = Field(default="action-plan", description="prd-update | slack-alert | action-plan")
    title: str = Field(description="a short, specific title for the proposal")
    body: str = Field(description="the proposal as markdown a human can review, edit and approve")

class GeneratedSpec(_Camel):
    """Orbit's recommended response to a finding. The agent first DECIDES what the
    finding actually needs (action_type) — not everything is code — then shapes the
    detail accordingly. Grounded in retrieved company context."""

    action_type: str = Field(
        description="the response Orbit decided this finding needs: 'code' (a code change) | 'investigate' "
        "(root-cause unclear, look into it first) | 'coordinate' (a process/ownership action: assign, "
        "prioritize, unblock, split, close) | 'communicate' (tell a customer or team) | 'decision' (a human "
        "must make a call)")
    title: str = Field(description="concise, specific title for the recommended action")
    why: str = Field(description="1-2 sentences: the promise/gap/drift/finding this came from")
    what: str = Field(description="1-3 sentences on the recommended response")
    done_when: list[str] = Field(default_factory=list, description="acceptance criteria, each a checkable outcome")
    context: list[str] = Field(default_factory=list,
                               description="relevant identifiers, PRs, docs, people and constraints from company memory")
    agent_spec: str = Field(
        description="the FULL recommended action as markdown, shaped by action_type. When action_type='code': "
        "a prompt to paste into Cursor/Claude Code — '# Task', '## Objective', '## Investigate first' (tell it "
        "to explore the repo and locate the code; never fabricate file paths), '## Requirements', "
        "'## Acceptance criteria', '## Constraints & out of scope'. Otherwise: the concrete plan, drafted "
        "message, or framed decision (with options + a recommendation) — clear headings and numbered steps")


class IntelligenceBrief(_Camel):
    """The periodic company brief — what leadership should know right now."""

    headline: str = Field(description="one sharp sentence on the company's current state")
    summary: str = Field(description="2-4 sentences: what happened, what it means")
    risks: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


class ChatAnswer(_Camel):
    """Orbit's grounded answer to a question about the company."""

    answer: str = Field(description="concise, specific answer in plain business English")
    citation_ids: list[str] = Field(
        default_factory=list,
        description="ids of the EVIDENCE items actually used — only ids present in EVIDENCE, never invented",
    )
    grounded: bool = Field(
        default=True, description="true if answered from the company's data; false if from general knowledge"
    )
