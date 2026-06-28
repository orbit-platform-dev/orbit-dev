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


# --- Product Manager --------------------------------------------------------
class UserStory(_Camel):
    persona: str
    story: str
    priority: str = Field(description="P0 | P1 | P2")


class SuccessMetric(_Camel):
    metric: str
    target: str


class PRDDraft(_Camel):
    problem: str
    goals: list[str]
    non_goals: list[str]
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


# --- Execution Router -------------------------------------------------------
class TeamDecision(_Camel):
    team: str = Field(description="engineering | design | qa | sales | customer-success")
    relevant: bool
    reason: str


class ExecutionPlan(_Camel):
    """Which teams this conversation actually requires, and why."""

    teams: list[TeamDecision]
