"""Deterministic, transcript-derived fallbacks.

These let the whole pipeline run offline (no model calls) while still producing
plausible, transcript-grounded structured output. Returned dicts are camelCase
to match the agents' aliased schemas.
"""
from __future__ import annotations

import re

_FEATURE_HINTS = {
    "sso": ("SAML SSO", "Security"),
    "scim": ("SCIM provisioning", "Security"),
    "audit": ("Audit log export", "Compliance"),
    "rbac": ("Role-based access control", "Security"),
    "role": ("Role-based access control", "Security"),
    "report": ("Native reporting", "Analytics"),
    "dashboard": ("Analytics dashboards", "Analytics"),
    "residency": ("Data residency", "Compliance"),
    "api": ("API improvements", "Platform"),
}
_NEGATIVE = ("blocker", "frustrat", "fail", "risk", "concern", "issue", "alternativ", "deprecat")
_POSITIVE = ("love", "great", "excellent", "fantastic", "happy", "perfect", "resolve")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def fallback_signals(transcript: str, account: str) -> dict:
    lower = transcript.lower()
    sents = _sentences(transcript)[:40]

    neg = sum(lower.count(w) for w in _NEGATIVE)
    pos = sum(lower.count(w) for w in _POSITIVE)
    score = max(0.05, min(0.95, 0.5 + 0.08 * (pos - neg)))
    overall = "mixed" if abs(pos - neg) <= 1 else ("positive" if pos > neg else "negative")
    urgency = "critical" if neg >= 3 else "high" if neg == 2 else "medium" if neg == 1 else "low"

    features, seen = [], set()
    for hint, (title, cat) in _FEATURE_HINTS.items():
        if hint in lower and title not in seen:
            seen.add(title)
            features.append({"title": title, "description": f"Requested by {account or 'the customer'}.",
                             "demand": min(95, 60 + 8 * lower.count(hint)), "effort": "L", "category": cat})

    pains = [{"title": f"Concern: {s[:60]}", "description": s, "severity": "high", "frequency": 1}
             for s in sents if any(w in s.lower() for w in _NEGATIVE)][:3]

    revenue = 0.0
    for m in re.findall(r"\$\s?([0-9][0-9.,]*)\s?([kKmM])", transcript):
        num = float(m[0].replace(",", ""))
        revenue = max(revenue, num * (1_000 if m[1].lower() == "k" else 1_000_000))
    if revenue == 0 and neg:
        revenue = 120_000.0 * neg

    return {
        "summary": (sents[0] if sents else "Customer conversation analyzed.")
        + (f" {account} discussion with {len(features)} feature signal(s) detected." if features else ""),
        "keyTakeaways": [s[:120] for s in sents[:3]] or ["Transcript analyzed."],
        "overallSentiment": overall,
        "sentimentScore": round(score, 2),
        "urgency": urgency,
        "revenueImpact": revenue,
        "painPoints": pains,
        "featureRequests": features,
        "opportunities": (
            [{"title": f"{account} opportunity", "description": "Capability gap maps to a revenue opportunity.",
              "revenueImpact": revenue or 80_000, "confidence": 65, "timeframe": "This quarter", "type": "retention"}]
            if (revenue or features) else []
        ),
        "actionItems": [{"title": f"Follow up on: {f['title']}", "owner": "Account team", "status": "open"} for f in features[:3]],
    }


def fallback_prd(signals: dict) -> dict:
    frs = signals.get("featureRequests", [])
    primary = frs[0]["title"] if frs else "Requested capability"
    return {
        "problem": f"Customers need {primary.lower()}; it is blocking adoption and revenue.",
        "goals": [f"Ship {fr['title']}" for fr in frs[:3]] or [f"Deliver {primary}"],
        "nonGoals": ["Out-of-scope edge cases", "Net-new platform rewrites"],
        "successMetrics": [{"metric": "Adoption", "target": "> 80%"}, {"metric": "Time to value", "target": "< 1 week"}],
        "userStories": [{"persona": "Admin", "story": f"Use {fr['title']} to unblock my team.", "priority": "P0"} for fr in frs[:3]]
        or [{"persona": "User", "story": f"Use {primary}.", "priority": "P0"}],
    }


def fallback_engineering(prd: dict) -> dict:
    return {
        "architecture": f"Implement {prd.get('goals', ['the capability'])[0]} as an isolated service to limit blast radius.",
        "components": ["service skeleton", "core domain logic", "API endpoints", "admin UI"],
        "estimateWeeks": 4 + len(prd.get("userStories", [])),
        "risks": ["Integration edge cases", "Session/state consistency"],
    }


def fallback_design(prd: dict) -> dict:
    return {
        "summary": "Guided, self-serve experience aligned to the design system.",
        "flows": ["Setup", "Configure", "Verify"],
        "screens": ["Overview", "Configuration", "Status / log"],
    }


def fallback_qa(prd: dict) -> dict:
    return {
        "strategy": "Risk-based: prioritize the highest-impact paths with automated coverage.",
        "testCases": [f"Verify: {g}" for g in prd.get("goals", [])][:4] or ["Happy path", "Error handling"],
        "coverageEstimate": 55,
    }


def fallback_sales(prd: dict) -> dict:
    return {
        "positioning": f"Now ready: {prd.get('goals', ['new capability'])[0]}.",
        "talkingPoints": [f"Delivers {g}" for g in prd.get("goals", [])][:3] or ["Solves the core need"],
        "targetSegments": ["Enterprise", "Security-conscious mid-market"],
    }


def fallback_route(signals: dict, prd: dict) -> dict:
    """Deterministic routing when AI is off — involve the obvious teams."""
    has_features = bool(signals.get("featureRequests"))
    has_opportunity = bool(signals.get("opportunities"))
    return {"teams": [
        {"team": "engineering", "relevant": has_features, "reason": "Implements the requested capability." if has_features else "No build work identified."},
        {"team": "design", "relevant": has_features, "reason": "Shapes the user experience." if has_features else "No user-facing change identified."},
        {"team": "qa", "relevant": has_features, "reason": "Validates the change before release." if has_features else "Nothing to test."},
        {"team": "sales", "relevant": has_opportunity, "reason": "Tied to a revenue opportunity." if has_opportunity else "No clear revenue tie."},
        {"team": "customer-success", "relevant": True, "reason": "Close the loop with the customer."},
    ]}


def fallback_customer_update(signals: dict, account: str) -> dict:
    items = signals.get("featureRequests", [])
    primary = items[0]["title"] if items else "your request"
    return {
        "subject": f"Update on {primary} for {account}",
        "body": f"Hi team — following up on our conversation, {primary} is now in active development. "
        "We'll share a firm timeline this week and keep you posted on progress.",
        "commitments": [f"Deliver {it['title']}" for it in items[:3]] or ["Follow up with a timeline"],
    }
