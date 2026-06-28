import type { ExecutionGraph } from "@/lib/types";
import { ago, days, hours, mins } from "./time";

// The signature pipeline for the Enterprise SSO project — Northwind meeting all
// the way through to customer follow-up.
export const executionGraph: ExecutionGraph = {
  nodes: [
    {
      id: "g_meeting", kind: "meeting", title: "Northwind Q2 Escalation", subtitle: "Zoom · 38 min · 3 participants",
      status: "completed", agent: "meeting-intelligence", progress: 100, owner: "Hana Kim", projectId: "p_1",
      meta: { Account: "Northwind Labs", "Revenue at risk": "$480K", Sentiment: "Mixed" },
      history: [
        { at: ago(mins(12)), event: "Recording uploaded", actor: "Zoom integration" },
        { at: ago(mins(11)), event: "Transcript ready (4 speakers)", actor: "Meeting Intelligence" },
        { at: ago(mins(9)), event: "Analysis complete — 6 signals extracted", actor: "Meeting Intelligence" },
      ],
    },
    {
      id: "g_goal", kind: "business-goal", title: "Secure $480K renewal", subtitle: "Convert churn risk → multi-year",
      status: "completed", agent: "leadership-advisor", progress: 100, owner: "Mara Vossen", projectId: "p_1",
      meta: { Confidence: "82%", Timeframe: "Q3 2026", Type: "Retention" },
      history: [{ at: ago(mins(8)), event: "Goal derived from escalation", actor: "Leadership Advisor" }],
    },
    {
      id: "g_feature", kind: "feature-request", title: "SAML SSO + SCIM", subtitle: "Demand 94 · Effort L",
      status: "completed", agent: "meeting-intelligence", progress: 100, projectId: "p_1",
      meta: { Demand: "94/100", Category: "Security", "Also requested by": "Vertex, Quanta" },
      history: [{ at: ago(mins(8)), event: "Feature request synthesized from 4 meetings", actor: "Meeting Intelligence" }],
    },
    {
      id: "g_prd", kind: "prd", title: "Enterprise SSO & SCIM — PRD", subtitle: "5 stories · 3 P0",
      status: "completed", agent: "product-manager", progress: 100, owner: "Product Manager", projectId: "p_1",
      meta: { Stories: 5, P0: 3, "Success metrics": 3 },
      history: [
        { at: ago(mins(40)), event: "Problem framed", actor: "Product Manager" },
        { at: ago(mins(35)), event: "PRD published (2,180 words)", actor: "Product Manager" },
      ],
    },
    {
      id: "g_eng", kind: "engineering", title: "Identity Broker Plan", subtitle: "6 wks · 5 components",
      status: "active", agent: "engineering-planner", progress: 46, owner: "Devin Okafor", projectId: "p_1",
      meta: { Estimate: "6 weeks", Components: 5, Tasks: 9, "In progress": 2 },
      history: [
        { at: ago(mins(22)), event: "Architecture proposed", actor: "Engineering Planner" },
        { at: ago(mins(18)), event: "9 tasks seeded to board", actor: "Engineering Planner" },
        { at: ago(hours(2)), event: "SAML validator in progress", actor: "Devin Okafor" },
      ],
    },
    {
      id: "g_design", kind: "design", title: "SSO Setup Flow", subtitle: "3 flows · 7 screens",
      status: "active", agent: "design-planner", progress: 55, owner: "Priya Nair", projectId: "p_1",
      meta: { Flows: 3, Screens: 7, Done: 2, "In progress": 2 },
      history: [
        { at: ago(mins(130)), event: "Flows defined", actor: "Design Planner" },
        { at: ago(hours(5)), event: "Stepper UI in progress", actor: "Priya Nair" },
      ],
    },
    {
      id: "g_qa", kind: "qa", title: "SSO Test Plan", subtitle: "Coverage 58% · 1 failing",
      status: "blocked", agent: "qa-planner", progress: 58, owner: "Tomás Reyes", projectId: "p_1",
      meta: { Coverage: "58%", "Test cases": 6, Failing: 1, Pending: 3 },
      history: [
        { at: ago(mins(1500)), event: "Test plan drafted", actor: "QA Planner" },
        { at: ago(hours(1)), event: "tc_5 failing — session revocation > 5m", actor: "QA Planner" },
      ],
    },
    {
      id: "g_sales", kind: "sales", title: "Enterprise Security Brief", subtitle: "3 deals · $1.33M pipeline",
      status: "active", agent: "sales-planner", progress: 70, owner: "Hana Kim", projectId: "p_1",
      meta: { Pipeline: "$1.33M", Deals: 3, "One-pager": "In review" },
      history: [{ at: ago(mins(50)), event: "Sales brief drafted", actor: "Sales Planner" }],
    },
    {
      id: "g_deploy", kind: "deployment", title: "Private Beta", subtitle: "Northwind + Vertex",
      status: "pending", progress: 0, owner: "Devin Okafor", projectId: "p_1",
      meta: { Target: "Aug 14, 2026", Cohort: "2 accounts", Flag: "sso_beta" },
      history: [{ at: ago(-days(48)), event: "Targeted for private beta", actor: "Engineering Planner" }],
    },
    {
      id: "g_cs", kind: "customer-followup", title: "Northwind Follow-up", subtitle: "Commitment + timeline",
      status: "active", agent: "customer-success", progress: 60, owner: "Leo Bianchi", projectId: "p_1",
      meta: { Promises: 4, Draft: "Ready", "Next call": "Friday" },
      history: [
        { at: ago(mins(6)), event: "4 commitments logged", actor: "Customer Success" },
        { at: ago(mins(3)), event: "Follow-up draft prepared", actor: "Customer Success" },
      ],
    },
  ],
  edges: [
    { id: "e1", source: "g_meeting", target: "g_goal", animated: false, label: "derives" },
    { id: "e2", source: "g_goal", target: "g_feature", animated: false, label: "requires" },
    { id: "e3", source: "g_feature", target: "g_prd", animated: false, label: "specs" },
    { id: "e4", source: "g_prd", target: "g_eng", animated: true, label: "plans" },
    { id: "e5", source: "g_prd", target: "g_design", animated: true, label: "designs" },
    { id: "e6", source: "g_eng", target: "g_qa", animated: true, label: "verifies" },
    { id: "e7", source: "g_design", target: "g_qa", animated: false },
    { id: "e8", source: "g_eng", target: "g_sales", animated: true, label: "enables" },
    { id: "e9", source: "g_qa", target: "g_deploy", animated: false, label: "gates" },
    { id: "e10", source: "g_sales", target: "g_deploy", animated: false },
    { id: "e11", source: "g_deploy", target: "g_cs", animated: true, label: "closes loop" },
  ],
};
