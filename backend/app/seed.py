"""Seed a representative dataset mirroring the frontend domain.

This makes the API return coherent data out of the box. The Next.js app ships a
fuller in-memory mock; pointing it at this backend (NEXT_PUBLIC_API_URL) swaps in
these records. Timestamps are anchored to load time so "x ago" stays fresh.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models

_now = datetime.now(timezone.utc)


def ago(**kw) -> datetime:
    return _now - timedelta(**kw)


def ahead(**kw) -> datetime:
    return _now + timedelta(**kw)


def _baseline_integrations() -> list:
    """The integration catalog. Only Jira & Linear are wired as (fake) connectors;
    the rest are surfaced as 'coming soon'. Returns fresh ORM instances per call."""
    return [
        models.Integration(key="jira", name="Jira", category="Engineering", description="Push generated work items into Jira projects.", status="disconnected"),
        models.Integration(key="linear", name="Linear", category="Engineering", description="Push generated work items into Linear as issues.", status="disconnected"),
        models.Integration(key="github", name="GitHub", category="Engineering", description="Sync tasks to issues, link PRs.", status="coming-soon"),
        models.Integration(key="slack", name="Slack", category="Communication", description="Post summaries and follow-ups to channels.", status="coming-soon"),
        models.Integration(key="notion", name="Notion", category="Product", description="Publish PRDs and specs.", status="coming-soon"),
        models.Integration(key="hubspot", name="HubSpot", category="CRM", description="Sync accounts, deals and signals.", status="coming-soon"),
        models.Integration(key="salesforce", name="Salesforce", category="CRM", description="Map opportunities to pipeline.", status="coming-soon"),
        models.Integration(key="calendar", name="Google Calendar", category="Calendar", description="Sync upcoming meetings into Orbit — read-only, your calendar stays the source of truth.", status="disconnected"),
        models.Integration(key="google-meet", name="Google Meet", category="Conferencing", description="Import Meet transcripts as signals — analyzed like every other conversation.", status="disconnected"),
        models.Integration(key="zoom", name="Zoom", category="Conferencing", description="Import cloud-recording transcripts into Meetings.", status="disconnected"),
        models.Integration(key="gong", name="Gong", category="Conferencing", description="Ingest call recordings and revenue signals.", status="coming-soon"),
        models.Integration(key="intercom", name="Intercom", category="Support", description="Turn support conversations into intent.", status="coming-soon"),
        models.Integration(key="asana", name="Asana", category="Engineering", description="Sync work items to Asana projects.", status="coming-soon"),
        models.Integration(key="confluence", name="Confluence", category="Product", description="Publish PRDs to Confluence spaces.", status="disconnected"),
        models.Integration(key="google-docs", name="Google Docs", category="Product", description="Publish approved PRDs to a commentable Google Doc.", status="disconnected"),
    ]


async def ensure_integrations(db: AsyncSession) -> None:
    """Backfill any missing integration rows (independent of the demo seed gate),
    so the catalog is always present even on a DB that already has user data."""
    existing = set((await db.execute(select(models.Integration.key))).scalars().all())
    missing = [i for i in _baseline_integrations() if i.key not in existing]
    if missing:
        db.add_all(missing)
        await db.commit()


async def seed_if_empty(db: AsyncSession) -> None:
    existing = await db.scalar(select(models.Meeting).limit(1))
    if existing:
        return

    members = [
        models.Member(id="u_1", name="Yash Pandey", email="yash@batton.co.jp", role="Owner", title="Founder & CEO"),
        models.Member(id="u_2", name="Mara Vossen", email="mara@orbit.app", role="Admin", title="Head of Product"),
        models.Member(id="u_3", name="Devin Okafor", email="devin@orbit.app", role="Admin", title="Eng Lead"),
        models.Member(id="u_4", name="Priya Nair", email="priya@orbit.app", role="Member", title="Staff Designer"),
        models.Member(id="u_5", name="Hana Kim", email="hana@orbit.app", role="Member", title="Account Executive"),
    ]

    def m(i):
        return {"id": members[i].id, "name": members[i].name, "email": members[i].email,
                "role": members[i].role, "title": members[i].title, "status": "active"}

    agents = [
        models.Agent(key="meeting-intelligence", name="Signal Intelligence", role="Ingest & comprehend",
                     description="Transcribes recordings and extracts pain points, requests, sentiment and revenue signals.",
                     model="claude-opus-4-8", status="running", confidence=96, execution_time_sec=42, completed_tasks=218,
                     color="#6366f1", current_thought="Cross-referencing Northwind's escalation against 3 prior calls.",
                     documents=[{"id": "d1", "title": "Northwind Q2 — Analysis", "type": "Report", "createdAt": ago(minutes=8).isoformat(), "wordCount": 1240}],
                     recent_runs=[{"id": "r1", "step": "Signal extraction", "detail": "6 pain points, 3 requests", "at": ago(minutes=8).isoformat(), "tokens": 8800}]),
        models.Agent(key="product-manager", name="Product Manager", role="Define what to build",
                     description="Turns signals into structured PRDs with goals, metrics and prioritized stories.",
                     model="claude-opus-4-8", status="thinking", confidence=91, execution_time_sec=67, completed_tasks=142,
                     color="#8b5cf6", current_thought="Sequencing P0 scope: SSO unblocks $1.2M; SCIM unblocks Vertex.",
                     documents=[{"id": "d2", "title": "Enterprise SSO & SCIM — PRD", "type": "PRD", "createdAt": ago(minutes=35).isoformat(), "wordCount": 2180, "projectId": "p_1"}],
                     recent_runs=[{"id": "r1", "step": "Story generation", "detail": "Drafted 11 user stories", "at": ago(minutes=36).isoformat(), "tokens": 9400}]),
        models.Agent(key="engineering-planner", name="Engineering Planner", role="Plan how to build",
                     description="Decomposes PRDs into architecture, components, APIs and risks, then seeds tasks.",
                     model="claude-opus-4-8", status="running", confidence=88, execution_time_sec=103, completed_tasks=96,
                     color="#0ea5e9", current_thought="Mapping SAML + OIDC onto the auth service via an identity-broker.",
                     documents=[{"id": "d3", "title": "Identity Broker — Plan", "type": "Spec", "createdAt": ago(minutes=18).isoformat(), "wordCount": 2960, "projectId": "p_1"}],
                     recent_runs=[{"id": "r1", "step": "Architecture", "detail": "Proposed identity-broker", "at": ago(minutes=22).isoformat(), "tokens": 11200}]),
        models.Agent(key="design-planner", name="Design Planner", role="Shape the experience",
                     description="Produces user flows, screen inventories and component requirements.",
                     model="claude-sonnet-4-6", status="completed", confidence=84, execution_time_sec=71, completed_tasks=78,
                     color="#ec4899", documents=[], recent_runs=[{"id": "r1", "step": "Flow mapping", "detail": "3 flows defined", "at": ago(minutes=130).isoformat()}]),
        models.Agent(key="qa-planner", name="QA Planner", role="Guarantee quality",
                     description="Builds test strategies and case matrices, tracks coverage and release risk.",
                     model="claude-sonnet-4-6", status="idle", confidence=82, execution_time_sec=0, completed_tasks=54,
                     color="#10b981", documents=[], recent_runs=[]),
        models.Agent(key="sales-planner", name="Sales Planner", role="Connect to revenue",
                     description="Crafts positioning, talk tracks and pricing mapped to the open pipeline.",
                     model="claude-sonnet-4-6", status="thinking", confidence=79, execution_time_sec=28, completed_tasks=61,
                     color="#f59e0b", current_thought="Linking enterprise SSO to 3 deals in negotiation.",
                     documents=[], recent_runs=[]),
        models.Agent(key="customer-success", name="Customer Success", role="Close the loop",
                     description="Drafts customer updates, tracks commitments and schedules follow-ups.",
                     model="claude-sonnet-4-6", status="running", confidence=87, execution_time_sec=15, completed_tasks=113,
                     color="#14b8a6", current_thought="Preparing an update for Rachel at Northwind.",
                     documents=[], recent_runs=[]),
        models.Agent(key="leadership-advisor", name="Leadership Advisor", role="Steer the portfolio",
                     description="Aggregates signals into executive briefings: revenue at risk and where to focus.",
                     model="claude-opus-4-8", status="completed", confidence=93, execution_time_sec=88, completed_tasks=37,
                     color="#f43f5e", documents=[], recent_runs=[]),
    ]

    analysis = {
        "summary": "Northwind Labs ($480K ARR) treats enterprise SSO as a hard renewal blocker: SAML, SCIM and an audit log. Otherwise highly satisfied.",
        "keyTakeaways": ["SSO raised in 4 of last 5 meetings", "Missing SCIM caused a failed SOC 2 audit", "$480K renewal hinges on August delivery"],
        "sentiment": {"overall": "mixed", "score": 0.42, "breakdown": [{"label": "Product satisfaction", "value": 0.78}, {"label": "Trust in roadmap", "value": 0.31}]},
        "urgency": "critical", "revenueImpact": 480000,
        "topics": [{"label": "SAML SSO", "weight": 0.9}, {"label": "SCIM", "weight": 0.74}, {"label": "Renewal", "weight": 0.81}],
        "painPoints": [{"id": "pp_1", "title": "No SAML SSO support", "description": "Security review blocks renewal.", "severity": "critical", "frequency": 4, "quotes": ["Orbit still doesn't support SAML SSO."]}],
        "featureRequests": [{"id": "fr_1", "title": "SAML SSO (Okta, Azure AD)", "description": "Standards-based SSO.", "demand": 94, "effort": "L", "category": "Security", "linkedProjectId": "p_1"}],
        "opportunities": [{"id": "op_1", "title": "Secure Northwind renewal", "description": "August SSO delivery converts churn risk.", "revenueImpact": 480000, "confidence": 82, "timeframe": "Q3 2026", "type": "retention"}],
        "actionItems": [{"id": "ai_1", "title": "Send Northwind a committed SSO timeline", "owner": "Hana Kim", "status": "in-progress"}],
    }
    transcript = [
        {"id": "t1", "speaker": "Marcus Webb", "speakerRole": "CTO, Northwind", "start": 4, "end": 22, "sentiment": "negative",
         "text": "Security review flagged that Orbit still doesn't support SAML SSO. That's a blocker for us renewing."},
        {"id": "t2", "speaker": "Rachel Lindqvist", "speakerRole": "VP Eng, Northwind", "start": 40, "end": 78, "sentiment": "mixed",
         "text": "SAML SSO with Okta, SCIM so we can deprovision leavers, and an exportable audit log. Without SCIM we failed our last SOC 2 audit."},
    ]
    meetings = [
        models.Meeting(id="m_1", title="Northwind Labs — Q2 Escalation & Renewal Risk", source="zoom", status="analyzed",
                       account="Northwind Labs", date=ago(minutes=12), duration_sec=2280, analysis_progress=100,
                       linked_project_id="p_1", tags=["renewal", "enterprise", "at-risk"],
                       participants=[{"id": "s_1", "name": "Rachel Lindqvist", "role": "VP Engineering", "company": "Northwind Labs", "type": "customer", "sentiment": "mixed"},
                                     {"id": "s_2", "name": "Marcus Webb", "role": "CTO", "company": "Northwind Labs", "type": "customer", "sentiment": "negative"}],
                       transcript=transcript, analysis=analysis),
        models.Meeting(id="m_2", title="Vertex Health — Onboarding & Rollout", source="google-meet", status="analyzed",
                       account="Vertex Health", date=ago(hours=4), duration_sec=1920, analysis_progress=100,
                       linked_project_id="p_3", tags=["onboarding", "expansion"], participants=[],
                       transcript=[], analysis={"summary": "Vertex wants to expand 25→240 seats, gated on SCIM + RBAC.",
                                                "keyTakeaways": ["Pilot succeeded", "Expansion gated on SCIM + RBAC"],
                                                "sentiment": {"overall": "positive", "score": 0.74, "breakdown": []},
                                                "urgency": "high", "revenueImpact": 312000, "topics": [],
                                                "painPoints": [], "featureRequests": [], "opportunities": [], "actionItems": []}),
        models.Meeting(id="m_3", title="Quanta Finance — Data Residency Deep Dive", source="google-meet", status="analyzing",
                       account="Quanta Finance", date=ago(minutes=34), duration_sec=1500, analysis_progress=62,
                       tags=["compliance", "enterprise"], participants=[], transcript=[], analysis=None),
    ]

    prd = {
        "generatedBy": "product-manager", "updatedAt": ago(minutes=35).isoformat(),
        "problem": "Enterprise customers cannot adopt without SAML SSO and SCIM. Blocking $480K Northwind renewal and $312K Vertex expansion.",
        "goals": ["Ship SAML 2.0 SSO (Okta, Azure AD, Google)", "Ship SCIM 2.0 provisioning", "Pass enterprise security review"],
        "nonGoals": ["On-prem deployment", "Per-resource ABAC"],
        "successMetrics": [{"metric": "Enterprise deals unblocked", "target": "≥ 3 / quarter"}, {"metric": "Deprovision latency", "target": "< 5 min"}],
        "userStories": [{"id": "us_1", "persona": "IT Admin", "story": "Connect our Okta tenant.", "priority": "P0"},
                        {"id": "us_2", "persona": "IT Admin", "story": "Auto-deprovision leavers via SCIM.", "priority": "P0"}],
        "sections": [{"heading": "Scope", "body": "SAML 2.0 flows; SCIM Users + Groups; admin UI; audit events."}],
    }
    engineering = {
        "architecture": "Dedicated identity-broker service terminating SAML/SCIM, exchanging for internal tokens.",
        "estimateWeeks": 6, "techStack": ["FastAPI", "SQLAlchemy", "Redis Streams", "python3-saml"],
        "components": [{"name": "identity-broker", "description": "Terminates SAML & SCIM.", "status": "in-progress"},
                       {"name": "SCIM endpoints", "description": "RFC 7644 provisioning API.", "status": "todo"}],
        "apis": [{"method": "POST", "path": "/auth/saml/{ws}/acs", "description": "Assertion consumer."},
                 {"method": "POST", "path": "/scim/v2/Users", "description": "Provision a user."}],
        "risks": [{"risk": "SAML signature edge cases across IdPs", "mitigation": "Conformance-test sandboxes.", "severity": "high"}],
    }
    projects = [
        models.Project(id="p_1", name="Enterprise SSO & SCIM", key="SSO",
                       description="SAML 2.0 SSO and SCIM 2.0 provisioning for enterprise identity providers.",
                       status="in-progress", health="at-risk", progress=46, start_date=ago(days=6), target_date=ahead(days=48),
                       delivery_estimate="Aug 14, 2026", source_meeting_id="m_1", revenue_impact=1680000,
                       owner=m(1), team=[m(1), m(2), m(0)], tags=["security", "enterprise", "p0"],
                       documents=[{"id": "d2", "title": "Enterprise SSO & SCIM — PRD", "type": "PRD", "createdAt": ago(minutes=35).isoformat(), "wordCount": 2180}],
                       prd=prd, engineering=engineering, design=None, qa=None, sales=None),
        models.Project(id="p_3", name="Role-Based Access Control", key="RBAC",
                       description="Granular roles and permission sets for large organizations.",
                       status="discovery", health="on-track", progress=12, start_date=ago(days=1), target_date=ahead(days=70),
                       delivery_estimate="Sep 2, 2026", source_meeting_id="m_2", revenue_impact=312000,
                       owner=m(0), team=[m(0), m(2)], tags=["security", "expansion"], documents=[], prd=None),
    ]

    tasks = [
        models.Task(id="tk_1", key="SSO-12", title="Stand up identity-broker skeleton", description="FastAPI service + Redis stream producer.",
                    column="done", priority="high", discipline="engineering", estimate=5, project_id="p_1", assignee=m(2),
                    labels=["backend"], links={"meetingId": "m_1"}, created_at=ago(days=5), updated_at=ago(days=2)),
        models.Task(id="tk_3", key="SSO-14", title="Implement SAML assertion validator", description="Signature, audience, replay protection.",
                    column="in-progress", priority="urgent", discipline="engineering", estimate=8, project_id="p_1", assignee=m(2),
                    labels=["backend", "security"], links={"meetingId": "m_1", "prdId": "d2"}, created_at=ago(days=4), updated_at=ago(hours=2)),
        models.Task(id="tk_4", key="SSO-15", title="SCIM Users endpoint", description="POST/PATCH users with filter parsing.",
                    column="todo", priority="high", discipline="engineering", estimate=8, project_id="p_1", assignee=m(2),
                    labels=["backend"], links={"prdId": "d2"}, created_at=ago(days=3), updated_at=ago(days=1)),
        models.Task(id="tk_5", key="SSO-16", title="Connect-provider stepper UI", description="5-step guided SAML connection flow.",
                    column="in-progress", priority="high", discipline="design", estimate=5, project_id="p_1", assignee=m(3),
                    labels=["frontend"], links={}, created_at=ago(days=3), updated_at=ago(hours=5)),
        models.Task(id="tk_7", key="SSO-18", title="Fix: SCIM deactivate must revoke sessions", description="Sessions persist after deprovision.",
                    column="review", priority="urgent", discipline="qa", estimate=3, project_id="p_1", assignee=m(2),
                    labels=["bug", "security"], links={}, created_at=ago(days=1), updated_at=ago(hours=1)),
        models.Task(id="tk_2", key="SSO-13", title="Send Northwind committed SSO timeline", description="Customer commitment with August target.",
                    column="in-progress", priority="urgent", discipline="sales", estimate=1, project_id="p_1", assignee=m(4),
                    labels=["customer", "renewal"], links={"meetingId": "m_1"}, created_at=ago(minutes=30), updated_at=ago(minutes=8)),
    ]

    db.add_all([*members, *agents, *meetings, *projects, *tasks, *timeline, *integrations, *activity])
    await db.commit()
