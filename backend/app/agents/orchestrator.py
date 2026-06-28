"""LangGraph orchestration of the Orbit agent pipeline.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from ..config import settings
from . import definitions as d
from . import fallback as fb
from . import schemas as s

logger = logging.getLogger("orbit.agents")


class PipelineState(TypedDict, total=False):
    meeting_id: str
    transcript: str
    account: str
    signals: dict[str, Any]
    prd: dict[str, Any]
    engineering: dict[str, Any]
    design: dict[str, Any]
    qa: dict[str, Any]
    sales: dict[str, Any]
    customer_update: dict[str, Any]
    teams: dict[str, Any]
    events: list[dict[str, Any]]


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


# --- Nodes ------------------------------------------------------------------
async def node_intelligence(state: PipelineState) -> PipelineState:
    t = state["transcript"]
    out = await _run_agent(
        "meeting-intelligence", s.MeetingSignals,
        f"Account: {state.get('account')}\n\nTranscript:\n{t}",
        lambda: fb.fallback_signals(t, state.get("account", "")),
    )
    state["signals"] = out
    state.setdefault("events", []).append({"agent": "meeting-intelligence", "step": "Signals extracted"})
    return state


async def node_pm(state: PipelineState) -> PipelineState:
    out = await _run_agent(
        "product-manager", s.PRDDraft,
        f"Meeting signals:\n{state['signals']}",
        lambda: fb.fallback_prd(state["signals"]),
    )
    state["prd"] = out
    state.setdefault("events", []).append({"agent": "product-manager", "step": "PRD drafted"})
    return state


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
        f"Meeting signals:\n{state['signals']}\n\nPRD:\n{state['prd']}",
        lambda: fb.fallback_route(state.get("signals", {}), state.get("prd", {})),
    )
    state["teams"] = {
        d["team"]: {"relevant": bool(d.get("relevant", True)), "reason": d.get("reason", "")}
        for d in out.get("teams", []) if d.get("team")
    }
    state.setdefault("events", []).append({"agent": "execution-router", "step": "Teams routed"})
    return state


async def node_engineering(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "engineering")
    if not relevant:
        state["engineering"] = {"skipped": True, "reason": reason}
        return state
    out = await _run_agent(
        "engineering-planner", s.EngineeringDraft,
        f"PRD:\n{state['prd']}",
        lambda: fb.fallback_engineering(state["prd"]),
    )
    state["engineering"] = out
    state.setdefault("events", []).append({"agent": "engineering-planner", "step": "Engineering planned"})
    return state


async def node_design(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "design")
    if not relevant:
        state["design"] = {"skipped": True, "reason": reason}
        return state
    out = await _run_agent(
        "design-planner", s.DesignDraft,
        f"PRD:\n{state['prd']}",
        lambda: fb.fallback_design(state["prd"]),
    )
    state["design"] = out
    state.setdefault("events", []).append({"agent": "design-planner", "step": "Design planned"})
    return state


async def node_qa(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "qa")
    if not relevant:
        state["qa"] = {"skipped": True, "reason": reason}
        return state
    out = await _run_agent(
        "qa-planner", s.QADraft,
        f"PRD:\n{state['prd']}\nEngineering:\n{state.get('engineering')}",
        lambda: fb.fallback_qa(state["prd"]),
    )
    state["qa"] = out
    state.setdefault("events", []).append({"agent": "qa-planner", "step": "QA planned"})
    return state


async def node_sales(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "sales")
    if not relevant:
        state["sales"] = {"skipped": True, "reason": reason}
        return state
    out = await _run_agent(
        "sales-planner", s.SalesDraft,
        f"Capability from PRD:\n{state['prd']}",
        lambda: fb.fallback_sales(state["prd"]),
    )
    state["sales"] = out
    state.setdefault("events", []).append({"agent": "sales-planner", "step": "Sales enabled"})
    return state


async def node_customer(state: PipelineState) -> PipelineState:
    relevant, reason = _relevant(state, "customer-success")
    if not relevant:
        state["customer_update"] = {"skipped": True, "reason": reason}
        return state
    out = await _run_agent(
        "customer-success", s.CustomerUpdateDraft,
        f"Account: {state.get('account')}\nSignals:\n{state['signals']}",
        lambda: fb.fallback_customer_update(state["signals"], state.get("account", "")),
    )
    state["customer_update"] = out
    state.setdefault("events", []).append({"agent": "customer-success", "step": "Follow-up drafted"})
    return state


def _build_graph():
    """Compile the LangGraph StateGraph (lazy import)."""
    from langgraph.graph import END, START, StateGraph

    g = StateGraph(PipelineState)
    g.add_node("intelligence", node_intelligence)
    g.add_node("pm", node_pm)
    g.add_node("engineering", node_engineering)
    g.add_node("design", node_design)
    g.add_node("qa", node_qa)
    g.add_node("sales", node_sales)
    g.add_node("customer", node_customer)
    g.add_node("route", node_route)

    g.add_edge(START, "intelligence")
    g.add_edge("intelligence", "pm")
    g.add_edge("pm", "route")
    g.add_edge("route", "engineering")
    g.add_edge("route", "design")
    g.add_edge("engineering", "qa")
    g.add_edge("design", "qa")
    g.add_edge("engineering", "sales")
    g.add_edge("qa", "customer")
    g.add_edge("sales", "customer")
    g.add_edge("customer", END)
    return g.compile()


async def run_pipeline(meeting_id: str, transcript: str, account: str) -> PipelineState:
    """Execute the full pipeline for a meeting and return the final state."""
    state: PipelineState = {"meeting_id": meeting_id, "transcript": transcript, "account": account, "events": []}
    try:
        graph = _build_graph()
        return await graph.ainvoke(state)
    except Exception:
        # LangGraph unavailable — run the (near-linear) pipeline directly.
        state = await node_intelligence(state)
        state = await node_pm(state)
        state = await node_route(state)
        state = await node_engineering(state)
        state = await node_design(state)
        state = await node_qa(state)
        state = await node_sales(state)
        state = await node_customer(state)
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
    }
