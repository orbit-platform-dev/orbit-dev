import type { Agent } from "@/lib/types";
import { ago, mins } from "./time";

export const agents: Agent[] = [
  {
    key: "meeting-intelligence",
    name: "Meeting Intelligence",
    role: "Ingest & comprehend",
    description:
      "Transcribes recordings, diarizes speakers, and extracts pain points, feature requests, sentiment and revenue signals from every conversation.",
    model: "claude-opus-4-8",
    status: "running",
    currentThought:
      "Cross-referencing Northwind's escalation against 3 prior calls — the SSO gap is now mentioned in 4 of their last 5 meetings.",
    confidence: 96,
    executionTimeSec: 42,
    completedTasks: 218,
    color: "#6366f1",
    documents: [
      { id: "d_mi_1", title: "Northwind Q2 Escalation — Analysis", type: "Report", createdAt: ago(mins(8)), wordCount: 1240 },
      { id: "d_mi_2", title: "Vertex Health Discovery — Signals", type: "Brief", createdAt: ago(mins(220)), wordCount: 860 },
    ],
    recentRuns: [
      { id: "r1", step: "Diarization", detail: "Separated 4 speakers across 38m recording", at: ago(mins(9)), tokens: 12400 },
      { id: "r2", step: "Signal extraction", detail: "Found 6 pain points, 3 feature requests", at: ago(mins(8)), tokens: 8800 },
      { id: "r3", step: "Revenue mapping", detail: "Estimated $480K ARR at risk", at: ago(mins(7)), tokens: 3200 },
    ],
  },
  {
    key: "product-manager",
    name: "Product Manager",
    role: "Define what to build",
    description:
      "Turns raw signals into structured PRDs — problem framing, goals, success metrics and prioritized user stories ready for engineering.",
    model: "claude-opus-4-8",
    status: "thinking",
    currentThought:
      "Weighing P0 scope: enterprise SSO covers 3 stalled deals worth $1.2M, but SCIM provisioning unblocks Vertex's rollout. Sequencing SSO first.",
    confidence: 91,
    executionTimeSec: 67,
    completedTasks: 142,
    color: "#8b5cf6",
    documents: [
      { id: "d_pm_1", title: "Enterprise SSO & SCIM — PRD", type: "PRD", createdAt: ago(mins(35)), wordCount: 2180, projectId: "p_1" },
      { id: "d_pm_2", title: "Audit Log Export — PRD", type: "PRD", createdAt: ago(mins(900)), wordCount: 1640, projectId: "p_2" },
    ],
    recentRuns: [
      { id: "r1", step: "Problem framing", detail: "Synthesized 4 meetings into one problem statement", at: ago(mins(40)), tokens: 6100 },
      { id: "r2", step: "Story generation", detail: "Drafted 11 user stories, prioritized P0–P2", at: ago(mins(36)), tokens: 9400 },
    ],
  },
  {
    key: "engineering-planner",
    name: "Engineering Planner",
    role: "Plan how to build",
    description:
      "Decomposes PRDs into architecture, components, API contracts and risk assessments, then estimates effort and seeds the task board.",
    model: "claude-opus-4-8",
    status: "running",
    currentThought:
      "Mapping SAML + OIDC flows onto the existing auth service. Proposing a dedicated identity-broker to avoid touching the session core.",
    confidence: 88,
    executionTimeSec: 103,
    completedTasks: 96,
    color: "#0ea5e9",
    documents: [
      { id: "d_eng_1", title: "Identity Broker — Technical Plan", type: "Spec", createdAt: ago(mins(18)), wordCount: 2960, projectId: "p_1" },
    ],
    recentRuns: [
      { id: "r1", step: "Architecture", detail: "Proposed identity-broker service + 4 components", at: ago(mins(22)), tokens: 11200 },
      { id: "r2", step: "Estimation", detail: "Sized at 6 weeks across 2 engineers", at: ago(mins(19)), tokens: 2400 },
      { id: "r3", step: "Task seeding", detail: "Created 9 engineering tasks", at: ago(mins(18)), tokens: 1800 },
    ],
  },
  {
    key: "design-planner",
    name: "Design Planner",
    role: "Shape the experience",
    description:
      "Produces user flows, screen inventories and component requirements aligned to the design system — handing off pixel-ready specs.",
    model: "claude-sonnet-4-6",
    status: "completed",
    currentThought: undefined,
    confidence: 84,
    executionTimeSec: 71,
    completedTasks: 78,
    color: "#ec4899",
    documents: [
      { id: "d_des_1", title: "SSO Setup Flow — Design Spec", type: "Spec", createdAt: ago(mins(120)), wordCount: 1420, projectId: "p_1" },
    ],
    recentRuns: [
      { id: "r1", step: "Flow mapping", detail: "Defined 3 flows: connect, provision, audit", at: ago(mins(130)), tokens: 5400 },
      { id: "r2", step: "Screen inventory", detail: "Specified 7 screens + empty states", at: ago(mins(122)), tokens: 4100 },
    ],
  },
  {
    key: "qa-planner",
    name: "QA Planner",
    role: "Guarantee quality",
    description:
      "Builds test strategies and case matrices from the PRD and eng plan, tracks coverage, and surfaces release risk before deployment.",
    model: "claude-sonnet-4-6",
    status: "idle",
    confidence: 82,
    executionTimeSec: 0,
    completedTasks: 54,
    color: "#10b981",
    documents: [
      { id: "d_qa_1", title: "SSO — Test Plan & Matrix", type: "Test Plan", createdAt: ago(mins(1500)), wordCount: 980, projectId: "p_1" },
    ],
    recentRuns: [
      { id: "r1", step: "Strategy", detail: "Drafted risk-based test strategy", at: ago(mins(1510)), tokens: 3300 },
    ],
  },
  {
    key: "sales-planner",
    name: "Sales Planner",
    role: "Connect to revenue",
    description:
      "Crafts positioning, talk tracks and pricing guidance from shipped capabilities, mapping features back to the open pipeline.",
    model: "claude-sonnet-4-6",
    status: "thinking",
    currentThought:
      "Linking enterprise SSO to 3 deals in negotiation. Drafting a one-pager for Hana to send Northwind before Friday's renewal call.",
    confidence: 79,
    executionTimeSec: 28,
    completedTasks: 61,
    color: "#f59e0b",
    documents: [
      { id: "d_sal_1", title: "Enterprise Security — Sales Brief", type: "Strategy", createdAt: ago(mins(50)), wordCount: 720, projectId: "p_1" },
    ],
    recentRuns: [
      { id: "r1", step: "Pipeline mapping", detail: "Matched feature to 3 open opportunities", at: ago(mins(55)), tokens: 2900 },
    ],
  },
  {
    key: "customer-success",
    name: "Customer Success",
    role: "Close the loop",
    description:
      "Drafts customer-facing updates, tracks commitments from each meeting, and schedules follow-ups so nothing slips after a call.",
    model: "claude-sonnet-4-6",
    status: "running",
    currentThought:
      "Preparing a personalized update for Rachel at Northwind: SSO is now in active development with a target of mid-August.",
    confidence: 87,
    executionTimeSec: 15,
    completedTasks: 113,
    color: "#14b8a6",
    documents: [
      { id: "d_cs_1", title: "Northwind — Follow-up Draft", type: "Brief", createdAt: ago(mins(3)), wordCount: 410 },
    ],
    recentRuns: [
      { id: "r1", step: "Commitment tracking", detail: "Logged 4 promises from Northwind call", at: ago(mins(6)), tokens: 2100 },
      { id: "r2", step: "Draft update", detail: "Wrote follow-up email + next steps", at: ago(mins(3)), tokens: 1700 },
    ],
  },
  {
    key: "leadership-advisor",
    name: "Leadership Advisor",
    role: "Steer the portfolio",
    description:
      "Aggregates signals across every meeting and project into executive briefings — revenue at risk, delivery confidence and where to focus.",
    model: "claude-opus-4-8",
    status: "completed",
    confidence: 93,
    executionTimeSec: 88,
    completedTasks: 37,
    color: "#f43f5e",
    documents: [
      { id: "d_lead_1", title: "Weekly Portfolio Briefing", type: "Report", createdAt: ago(mins(600)), wordCount: 1320 },
    ],
    recentRuns: [
      { id: "r1", step: "Portfolio scan", detail: "Reviewed 5 projects, 6 meetings", at: ago(mins(610)), tokens: 14200 },
      { id: "r2", step: "Briefing", detail: "Flagged $480K at risk, 2 projects at-risk", at: ago(mins(600)), tokens: 5600 },
    ],
  },
];

export const agentByKey = (key: string) => agents.find((a) => a.key === key);
