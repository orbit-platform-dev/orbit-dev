import type { ActivityEvent, CustomerRequest, FollowUp, MetricTrend } from "@/lib/types";
import { members } from "./members";
import { ago, days, hours, mins } from "./time";

const m = (i: number) => members[i];

export const activityEvents: ActivityEvent[] = [
  { id: "ac_1", actor: { name: "Customer Success", isAgent: true }, action: "drafted a follow-up for", target: "Northwind Labs", targetType: "meeting", at: ago(mins(3)), projectId: "p_1" },
  { id: "ac_2", actor: { name: "Devin Okafor" }, action: "moved", target: "SSO-14 to In Progress", targetType: "task", at: ago(mins(8)), projectId: "p_1" },
  { id: "ac_3", actor: { name: "Sales Planner", isAgent: true }, action: "generated", target: "Enterprise Security — Sales Brief", targetType: "document", at: ago(mins(50)), projectId: "p_1" },
  { id: "ac_4", actor: { name: "QA Planner", isAgent: true }, action: "flagged a failing test on", target: "SSO-18", targetType: "task", at: ago(hours(1)), projectId: "p_1" },
  { id: "ac_5", actor: { name: "Priya Nair" }, action: "updated the design spec for", target: "SSO Setup Flow", targetType: "document", at: ago(hours(5)), projectId: "p_1" },
  { id: "ac_6", actor: { name: "Engineering Planner", isAgent: true }, action: "seeded 9 tasks to", target: "Enterprise SSO & SCIM", targetType: "project", at: ago(mins(18)), projectId: "p_1" },
  { id: "ac_7", actor: { name: "Mara Vossen" }, action: "approved the PRD for", target: "Enterprise SSO & SCIM", targetType: "project", at: ago(mins(16)), projectId: "p_1" },
  { id: "ac_8", actor: { name: "Product Manager", isAgent: true }, action: "published", target: "Enterprise SSO & SCIM — PRD", targetType: "document", at: ago(mins(35)), projectId: "p_1" },
  { id: "ac_9", actor: { name: "Meeting Intelligence", isAgent: true }, action: "analyzed", target: "Vertex Health onboarding", targetType: "meeting", at: ago(hours(4)), projectId: "p_3" },
  { id: "ac_10", actor: { name: "Hana Kim" }, action: "connected", target: "Salesforce", targetType: "integration", at: ago(hours(6)) },
  { id: "ac_11", actor: { name: "Leadership Advisor", isAgent: true }, action: "published", target: "Weekly Portfolio Briefing", targetType: "document", at: ago(hours(10)) },
  { id: "ac_12", actor: { name: "Tomás Reyes" }, action: "added 4 test cases to", target: "SSO Test Plan", targetType: "document", at: ago(days(1)), projectId: "p_1" },
];

export const followUps: FollowUp[] = [
  { id: "f_1", title: "Send Northwind committed SSO timeline", account: "Northwind Labs", due: ago(-hours(20)), owner: m(5), priority: "urgent" },
  { id: "f_2", title: "Updated 240-seat pricing to Vertex", account: "Vertex Health", due: ago(-days(2)), owner: m(5), priority: "high" },
  { id: "f_3", title: "EU residency answer for Quanta", account: "Quanta Finance", due: ago(-days(3)), owner: m(2), priority: "high" },
  { id: "f_4", title: "Reporting roadmap demo for Meridian", account: "Meridian Retail", due: ago(-days(6)), owner: m(5), priority: "medium" },
];

export const customerRequests: CustomerRequest[] = [
  { id: "cr_1", account: "Northwind Labs", request: "SAML SSO + SCIM provisioning", demand: 94, revenueImpact: 480000, status: "planned", at: ago(mins(12)) },
  { id: "cr_2", account: "Vertex Health", request: "Role-based access control", demand: 76, revenueImpact: 312000, status: "triaged", at: ago(hours(4)) },
  { id: "cr_3", account: "Quanta Finance", request: "EU data residency", demand: 71, revenueImpact: 540000, status: "new", at: ago(mins(34)) },
  { id: "cr_4", account: "Meridian Retail", request: "Native analytics dashboards", demand: 68, revenueImpact: 96000, status: "triaged", at: ago(days(2)) },
  { id: "cr_5", account: "Helix Robotics", request: "API rate-limit increase", demand: 41, revenueImpact: 60000, status: "new", at: ago(mins(3)) },
];

export const revenueTrends: MetricTrend[] = [
  { label: "Pipeline influenced", value: "$3.4M", delta: 18.2, spark: [2.1, 2.3, 2.2, 2.6, 2.9, 3.1, 3.4] },
  { label: "Revenue at risk", value: "$480K", delta: -12.0, spark: [820, 760, 700, 640, 560, 520, 480] },
  { label: "Expansion identified", value: "$1.05M", delta: 24.5, spark: [0.4, 0.5, 0.6, 0.7, 0.85, 0.95, 1.05] },
  { label: "Avg. analysis time", value: "42s", delta: -31.0, spark: [98, 86, 74, 66, 58, 49, 42] },
];

export const deliveryEstimates = [
  { projectId: "p_1", name: "Enterprise SSO & SCIM", estimate: "Aug 14", confidence: 72, trend: "steady" as const },
  { projectId: "p_2", name: "Audit Log Export", estimate: "Aug 8", confidence: 84, trend: "up" as const },
  { projectId: "p_3", name: "Role-Based Access", estimate: "Sep 2", confidence: 61, trend: "up" as const },
  { projectId: "p_5", name: "EU Data Residency", estimate: "Pending", confidence: 28, trend: "down" as const },
];
