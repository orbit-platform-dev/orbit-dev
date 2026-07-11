"""Structured outputs for each agent.

Every agent returns a typed Pydantic object (PydanticAI validates the model's
output against these), and they serialize to camelCase so the result drops
straight into the frontend's data shapes.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Meeting Intelligence ---------------------------------------------------
class PainPoint(_Camel):
    title: str
    description: str
    severity: str = Field(description="critical | high | medium | low")
    frequency: int = 1


class FeatureRequest(_Camel):
    title: str
    description: str
    demand: int = Field(ge=0, le=100)
    effort: str = Field(description="S | M | L | XL")
    category: str


class Opportunity(_Camel):
    title: str
    description: str
    revenue_impact: float
    confidence: int = Field(ge=0, le=100)
    timeframe: str
    type: str = Field(description="expansion | new-logo | retention | upsell")


class ActionItem(_Camel):
    title: str
    owner: str
    status: str = "open"


class Bug(_Camel):
    title: str
    description: str
    severity: str = Field(description="critical | high | medium | low")


class Deadline(_Camel):
    title: str = Field(description="what is due")
    due: str = Field(description="when it's due, e.g. 'Aug 15' or 'before security review'")


class MeetingSignals(_Camel):
    """Output of the Meeting Intelligence agent."""

    summary: str
    key_takeaways: list[str]
    overall_sentiment: str = Field(description="positive | neutral | negative | mixed")
    sentiment_score: float = Field(ge=0, le=1)
    urgency: str
    revenue_impact: float
    pain_points: list[PainPoint]
    feature_requests: list[FeatureRequest]
    opportunities: list[Opportunity]
    action_items: list[ActionItem]
    bugs: list[Bug] = []
    customer_goals: list[str] = Field(default_factory=list, description="what the customer is ultimately trying to achieve")
    deadlines: list[Deadline] = []
    requested_integrations: list[str] = Field(default_factory=list, description="3rd-party tools the customer wants Orbit/the product to connect to")
    confidence: int = Field(default=70, ge=0, le=100, description="how confident this intent read is, given transcript clarity")


# --- Product Manager --------------------------------------------------------
class UserStory(_Camel):
    persona: str
    story: str
    priority: str = Field(description="P0 | P1 | P2")


class SuccessMetric(_Camel):
    metric: str
    target: str


class PRDDraft(_Camel):
    title: str = Field(default="", description="a concise, specific PRD title")
    problem: str
    background: str = Field(default="", description="context: why this matters now, what led here")
    goals: list[str]
    non_goals: list[str]
    functional_requirements: list[str] = Field(default_factory=list, description="what the system must do")
    acceptance_criteria: list[str] = Field(default_factory=list, description="testable conditions of done")
    dependencies: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    success_metrics: list[SuccessMetric]
    user_stories: list[UserStory]


# --- Engineering / Design / QA / Sales (concise drafts) ---------------------
class EngineeringDraft(_Camel):
    architecture: str
    components: list[str]
    estimate_weeks: int
    risks: list[str]


class DesignDraft(_Camel):
    summary: str
    flows: list[str]
    screens: list[str]


class QADraft(_Camel):
    strategy: str
    test_cases: list[str]
    coverage_estimate: int = Field(ge=0, le=100)


class SalesDraft(_Camel):
    positioning: str
    talking_points: list[str]
    target_segments: list[str]


class CustomerUpdateDraft(_Camel):
    subject: str
    body: str
    commitments: list[str]


class CRMFieldUpdate(_Camel):
    field: str = Field(description="CRM field to update, e.g. 'Stage', 'Next steps', 'Renewal risk'")
    value: str
    reason: str = Field(description="why this update, tied to meeting evidence")


class CRMUpdateDraft(_Camel):
    """Proposed CRM record update — reviewed and approved before any sync."""

    account_summary: str = Field(description="2-3 sentence account status after this meeting")
    opportunity_stage: str = Field(default="", description="proposed deal/opportunity stage")
    risk_level: str = Field(default="low", description="low | medium | high")
    next_steps: list[str] = Field(default_factory=list)
    field_updates: list[CRMFieldUpdate] = Field(default_factory=list)


class IntelligenceBrief(_Camel):
    """The periodic company brief — what leadership should know right now."""

    headline: str = Field(description="one sharp sentence on the company's current state")
    summary: str = Field(description="2-4 sentences: what happened, what it means")
    risks: list[str] = Field(default_factory=list, description="what threatens commitments or goals")
    highlights: list[str] = Field(default_factory=list, description="what went well or moved forward")
    recommendations: list[str] = Field(default_factory=list, description="what deserves attention next")


class TeamDecision(_Camel):
    team: str = Field(description="engineering | design | qa | sales | customer-success | crm")
    relevant: bool
    reason: str


class ExecutionPlan(_Camel):
    """Which teams this conversation actually requires, and why."""

    teams: list[TeamDecision]


# --- Execution Plan (work items) --------------------------------------------
class WorkItem(_Camel):
    """One concrete piece of work, attributed to a discipline. Every item explains WHY."""

    title: str
    description: str
    discipline: str = Field(description="product | engineering | design | qa | customer-success | sales")
    priority: str = Field(description="urgent | high | medium | low")
    suggested_owner: str = Field(description="role/title best suited to own this, e.g. 'Backend engineer'")
    estimate_points: int = Field(ge=0, le=21, description="story points (Fibonacci-ish)")
    reason: str = Field(description="why this work exists, tied to the customer intent or PRD")
    confidence: int = Field(ge=0, le=100)


class WorkPlan(_Camel):
    """The cross-functional execution plan as discrete, reasoned work items."""

    items: list[WorkItem]
