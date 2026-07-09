"""LangGraph orchestration of the Orbit agent pipeline.
"""

from __future__ import annotations

import logging
import operator
from typing import Annotated, Any, Awaitable, Callable, TypedDict

from ..config import settings
from . import definitions as d
from . import fallback as fb
from . import schemas as s

logger = logging.getLogger("orbit.agents")


class PipelineState(TypedDict, total=False):
    meeting_id: str
    transcript: str
    account: str
    context: str  # rendered ContextPackage — same block for every generator
    signals: dict[str, Any]
    prd: dict[str, Any]
    crm: dict[str, Any]
    engineering: dict[str, Any]
    design: dict[str, Any]
    qa: dict[str, Any]
    sales: dict[str, Any]
    customer_update: dict[str, Any]
    teams: dict[str, Any]
    work_plan: dict[str, Any]
    timeline: dict[str, Any]
    # Reducer channel: parallel branches append safely instead of colliding.
    events: Annotated[list[dict[str, Any]], operator.add]


async def _run_agent(key: str, output_type, prompt: str, fallback):
    """Run one agent node, degrading to the deterministic fallback."""
    if settings.ai_enabled:
        try:
            agent = d.build_agent(d.SYSTEM_PROMPTS[key], output_type)
            result = await agent.run(prompt)
            return result.output.model_dump(by_alias=True)
        except Exception:
            logger.warning(
                "agent %r (model=%s) failed; using deterministic fallback",
                key, settings.default_model, exc_info=True,
            )
    return fallback()


def _with_context(state: PipelineState, prompt: str) -> str:
    """Every generator consumes the same Context Package (when history exists)."""
    ctx = state.get("context") or ""
    if not ctx:
        return prompt
    return f"{d.CONTEXT_PREAMBLE}{ctx}\n\n{prompt}"


async def generate_prd_draft(signals: dict[str, Any], context: str = "") -> dict[str, Any]:
    """On-demand PRD generation (the review screen's Generate PRD button).

    Same agent and same Context Package rules as the pipeline — but run against
    the CURRENT (possibly human-edited) customer intent."""
    prompt = f"Meeting signals:\n{signals}"
    if context:
        prompt = f"{d.CONTEXT_PREAMBLE}{context}\n\n{prompt}"
    return await _run_agent("product-manager", s.PRDDraft, prompt, lambda: fb.fallback_prd(signals))


# --- Nodes ------------------------------------------------------------------
async def node_intelligence(state: PipelineState) -> PipelineState:
    t = state["transcript"]
    out = await _run_agent(
        "meeting-intelligence", s.MeetingSignals,
        _with_context(state, f"Account: {state.get('account')}\n\nTranscript:\n{t}"),
        lambda: fb.fallback_signals(t, state.get("account", "")),
    )
    return {"signals": out, "events": [{"agent": "meeting-intelligence", "step": "Signals extracted"}]}


async def node_pm(state: PipelineState) -> PipelineState:
    out = await _run_agent(
        "product-manager", s.PRDDraft,
        _with_context(state, f"Meeting signals:\n{state['signals']}"),
        lambda: fb.fallback_prd(state["signals"]),
    )
    return {"prd": out, "events": [{"agent": "product-manager", "step": "PRD drafted"}]}


def _relevant(state: PipelineState, team: str) -> tuple[bool, str]:
    """Whether the router marked a team relevant, with its reason (default: relevant)."""
    d = state.get("teams", {}).get(team)
    if not d:
        return True, ""
    return bool(d.get("relevant", True)), d.get("reason", "")


async def node_route(state: PipelineState) -> PipelineState:
    """Decide which teams this conversation actually needs — like a human operator would."""
    out = await _run_agent(
        "execution-router", s.ExecutionPlan,
        _with_context(state, f"Meeting signals:\n{state['signals']}\n\nPRD:\n{state['prd']}"),
        lambda: fb.fallback_route(state.get("signals", {}), state.get("prd", {})),
    )
    teams = {
        d["team"]: {"relevant": bool(d.get("relevant", True)), "reason": d.get("reason", "")}
        for d in out.get("teams", []) if d.get("team")
    }
    return {"teams": teams, "events": [{"agent": "execution-router", "step": "Teams routed"}]}


async def node_engineering(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "engineering")
    if not relevant:
        return {"engineering": {"skipped": True, "reason": reason}}
    out = await _run_agent(
        "engineering-planner", s.EngineeringDraft,
        _with_context(state, f"PRD:\n{state['prd']}"),
        lambda: fb.fallback_engineering(state["prd"]),
    )
    return {"engineering": out, "events": [{"agent": "engineering-planner", "step": "Engineering planned"}]}


async def node_design(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "design")
    if not relevant:
        return {"design": {"skipped": True, "reason": reason}}
    out = await _run_agent(
        "design-planner", s.DesignDraft,
        _with_context(state, f"PRD:\n{state['prd']}"),
        lambda: fb.fallback_design(state["prd"]),
    )
    return {"design": out, "events": [{"agent": "design-planner", "step": "Design planned"}]}


async def node_qa(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "qa")
    if not relevant:
        return {"qa": {"skipped": True, "reason": reason}}
    out = await _run_agent(
        "qa-planner", s.QADraft,
        _with_context(state, f"PRD:\n{state['prd']}\nEngineering:\n{state.get('engineering')}"),
        lambda: fb.fallback_qa(state["prd"]),
    )
    return {"qa": out, "events": [{"agent": "qa-planner", "step": "QA planned"}]}


async def node_sales(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "sales")
    if not relevant:
        return {"sales": {"skipped": True, "reason": reason}}
    out = await _run_agent(
        "sales-planner", s.SalesDraft,
        _with_context(state, f"Capability from PRD:\n{state['prd']}"),
        lambda: fb.fallback_sales(state["prd"]),
    )
    return {"sales": out, "events": [{"agent": "sales-planner", "step": "Sales enabled"}]}


async def node_crm(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "crm")
    if not relevant:
        return {"crm": {"skipped": True, "reason": reason}}
    out = await _run_agent(
        "crm-analyst", s.CRMUpdateDraft,
        _with_context(state, f"Account: {state.get('account')}\nSignals:\n{state['signals']}"),
        lambda: fb.fallback_crm_update(state["signals"], state.get("account", "")),
    )
    return {"crm": out, "events": [{"agent": "crm-analyst", "step": "CRM update proposed"}]}


async def node_customer(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "customer-success")
    if not relevant:
        return {"customer_update": {"skipped": True, "reason": reason}}
    out = await _run_agent(
        "customer-success", s.CustomerUpdateDraft,
        _with_context(state, f"Account: {state.get('account')}\nSignals:\n{state['signals']}"),
        lambda: fb.fallback_customer_update(state["signals"], state.get("account", "")),
    )
    return {"customer_update": out, "events": [{"agent": "customer-success", "step": "Follow-up drafted"}]}


_POINTS_PER_WEEK = 6
_PHASE_ORDER = ["product", "design", "engineering", "qa", "customer-success", "sales"]
_MILESTONE_LABEL = {
    "product": "Requirements locked", "design": "Designs ready", "engineering": "Build complete",
    "qa": "Validated", "customer-success": "Customer updated", "sales": "Positioned",
}


def _derive_timeline(items: list[dict]) -> dict:
    """Deterministically turn work items into duration, milestones and a critical path."""
    if not items:
        return {"durationWeeks": 0, "milestones": [], "criticalPath": [], "deliveryEstimate": "n/a", "confidence": 0}
    by_disc: dict[str, int] = {}
    for i in items:
        disc = i.get("discipline", "engineering")
        by_disc[disc] = by_disc.get(disc, 0) + int(i.get("estimatePoints") or 0)
    present = [d for d in _PHASE_ORDER if d in by_disc] + [d for d in by_disc if d not in _PHASE_ORDER]

    milestones, week = [], 0
    for disc in present:
        week += max(1, round(by_disc[disc] / _POINTS_PER_WEEK))
        milestones.append({
            "title": _MILESTONE_LABEL.get(disc, disc.title()), "week": week,
            "description": f"{disc.replace('-', ' ').title()} work done ({by_disc[disc]} pts).",
        })
    duration = week or 1
    critical = [d.replace("-", " ").title() for d in present if d in ("product", "engineering", "qa")]
    confs = [int(i.get("confidence") or 0) for i in items if i.get("confidence") is not None]
    return {
        "durationWeeks": duration,
        "milestones": milestones,
        "criticalPath": critical or [present[0].title()],
        "deliveryEstimate": f"~{duration} week{'s' if duration != 1 else ''}",
        "confidence": round(sum(confs) / len(confs)) if confs else 60,
    }


async def node_plan(state: PipelineState) -> PipelineState:
    """Generate the cross-functional execution plan (work items), then derive its timeline."""
    out = await _run_agent(
        "execution-planner", s.WorkPlan,
        _with_context(state, f"PRD:\n{state.get('prd')}\n\nSignals:\n{state.get('signals')}\n\nRelevant teams:\n{state.get('teams')}"),
        lambda: fb.fallback_workplan(state.get("prd", {}), state.get("signals", {}), state.get("teams", {})),
    )
    return {"work_plan": out, "timeline": _derive_timeline(out.get("items", [])),
            "events": [{"agent": "execution-planner", "step": "Execution plan built"}]}


def _build_graph():
    """Compile the LangGraph StateGraph (lazy import)."""
    from langgraph.graph import END, START, StateGraph

    g = StateGraph(PipelineState)
    g.add_node("intelligence", node_intelligence)
    g.add_node("pm", node_pm)
    g.add_node("crm", node_crm)
    g.add_node("engineering", node_engineering)
    g.add_node("design", node_design)
    g.add_node("qa", node_qa)
    g.add_node("sales", node_sales)
    g.add_node("customer", node_customer)
    g.add_node("route", node_route)
    g.add_node("plan", node_plan)

    g.add_edge(START, "intelligence")
    g.add_edge("intelligence", "pm")
    g.add_edge("pm", "route")
    g.add_edge("route", "crm")
    g.add_edge("route", "engineering")
    g.add_edge("route", "design")
    g.add_edge("engineering", "qa")
    g.add_edge("design", "qa")
    g.add_edge("engineering", "sales")
    g.add_edge("qa", "plan")
    g.add_edge("sales", "plan")
    g.add_edge("crm", "plan")
    g.add_edge("plan", "customer")
    g.add_edge("customer", END)
    return g.compile()


# Real progress checkpoints: each state key appears as its agent stage finishes, so
# the % is derived from how far the pipeline has actually gotten (not a placeholder).
_PROGRESS_STEPS: list[tuple[str, int, str]] = [
    ("signals", 15, "Signals extracted"),
    ("prd", 28, "PRD drafted"),
    ("teams", 38, "Sections routed"),
    ("crm", 46, "CRM update proposed"),
    ("engineering", 55, "Engineering planned"),
    ("design", 62, "Design planned"),
    ("qa", 68, "QA planned"),
    ("sales", 72, "Sales enabled"),
    ("work_plan", 85, "Execution plan built"),
    ("customer_update", 95, "Follow-up drafted"),
]


def _progress_from_state(state: PipelineState) -> tuple[int, str]:
    """Highest checkpoint whose output already exists in the state."""
    pct, label = 5, "Analyzing the call…"
    for key, p, lbl in _PROGRESS_STEPS:
        if state.get(key):
            pct, label = p, lbl
    return pct, label


ProgressCallback = Callable[[int, str], Awaitable[None]]


async def run_pipeline(
    meeting_id: str, transcript: str, account: str, on_progress: ProgressCallback | None = None,
    context: str = "",
) -> PipelineState:
    """Execute the full pipeline for a meeting, reporting real per-stage progress.

    `context` is the rendered ContextPackage from the Context Engine — the same
    structured slice of customer history for every generator (empty on a first
    meeting)."""
    state: PipelineState = {"meeting_id": meeting_id, "transcript": transcript, "account": account,
                            "context": context, "events": []}

    async def _report(s: PipelineState) -> None:
        if on_progress:
            pct, label = _progress_from_state(s)
            await on_progress(pct, label)

    try:
        graph = _build_graph()
        final: PipelineState = state
        # `values` streams the full accumulated state after each super-step.
        async for snapshot in graph.astream(state, stream_mode="values"):
            final = snapshot
            await _report(snapshot)
        return final
    except Exception:
        # LangGraph unavailable — run the (near-linear) pipeline directly, still reporting progress.
        logger.warning("LangGraph streaming unavailable; running sequential pipeline", exc_info=True)
        for node in (node_intelligence, node_pm, node_route, node_crm, node_engineering,
                     node_design, node_qa, node_sales, node_plan, node_customer):
            update = await node(state)
            for k, v in update.items():
                if k == "events":
                    state["events"] = [*state.get("events", []), *v]
                else:
                    state[k] = v
            await _report(state)
        return state


_URGENCY = {"critical", "high", "medium", "low"}
_SENTIMENT = {"positive", "neutral", "negative", "mixed"}


def _norm(value: Any, allowed: set[str], default: str) -> str:
    """Coerce a model-produced string to a known enum value (the UI expects these)."""
    v = str(value or "").lower().strip()
    return v if v in allowed else default


def signals_to_analysis(signals: dict[str, Any]) -> dict[str, Any]:
    """Map agent signals onto the frontend's MeetingAnalysis shape (enums normalized)."""
    return {
        "summary": signals.get("summary", ""),
        "keyTakeaways": signals.get("keyTakeaways", []),
        "sentiment": {
            "overall": _norm(signals.get("overallSentiment"), _SENTIMENT, "neutral"),
            "score": signals.get("sentimentScore", 0.5),
            "breakdown": [{"label": "Overall", "value": signals.get("sentimentScore", 0.5)}],
        },
        "urgency": _norm(signals.get("urgency"), _URGENCY, "medium"),
        "revenueImpact": signals.get("revenueImpact", 0),
        "topics": [],
        "painPoints": [{"id": f"pp_{i}", "quotes": [], **p, "severity": _norm(p.get("severity"), _URGENCY, "medium")} for i, p in enumerate(signals.get("painPoints", []))],
        "featureRequests": [{"id": f"fr_{i}", **f} for i, f in enumerate(signals.get("featureRequests", []))],
        "opportunities": [{"id": f"op_{i}", **o} for i, o in enumerate(signals.get("opportunities", []))],
        "actionItems": [{"id": f"ai_{i}", **a} for i, a in enumerate(signals.get("actionItems", []))],
        "bugs": [{"id": f"bug_{i}", **b, "severity": _norm(b.get("severity"), _URGENCY, "medium")} for i, b in enumerate(signals.get("bugs", []))],
        "customerGoals": signals.get("customerGoals", []),
        "deadlines": [{"id": f"dl_{i}", **dl} for i, dl in enumerate(signals.get("deadlines", []))],
        "requestedIntegrations": signals.get("requestedIntegrations", []),
        "confidence": signals.get("confidence", 70),
    }
