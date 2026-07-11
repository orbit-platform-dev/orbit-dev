import type { Task } from "@/lib/types";
import { members } from "./members";
import { ago, days, hours, mins } from "./time";

const m = (i: number) => members[i];

export const tasks: Task[] = [
  {
    id: "tk_1", key: "SSO-12", title: "Stand up identity-broker service skeleton", description: "FastAPI service with health checks, config, and Redis stream producer.",
    column: "done", priority: "high", assignee: m(3), labels: ["backend", "infra"], estimate: 5, projectId: "p_1", discipline: "engineering",
    links: { meetingId: "m_1", prdId: "d_pm_1", featureRequestId: "fr_1" }, createdAt: ago(days(5)), updatedAt: ago(days(2)),
  },
  {
    id: "tk_2", key: "SSO-13", title: "Send Northwind committed SSO timeline", description: "Customer-facing commitment with August target.",
    column: "in-progress", priority: "urgent", assignee: m(5), labels: ["customer", "renewal"], estimate: 1, projectId: "p_1", discipline: "sales",
    links: { meetingId: "m_1", }, createdAt: ago(mins(30)), updatedAt: ago(mins(8)),
  },
  {
    id: "tk_3", key: "SSO-14", title: "Implement SAML assertion validator", description: "Signature, audience, replay protection across Okta/Azure/Google.",
    column: "in-progress", priority: "urgent", assignee: m(3), labels: ["backend", "security"], estimate: 8, projectId: "p_1", discipline: "engineering",
    links: { meetingId: "m_1", prdId: "d_pm_1", featureRequestId: "fr_1" }, createdAt: ago(days(4)), updatedAt: ago(hours(2)),
  },
  {
    id: "tk_4", key: "SSO-15", title: "SCIM Users endpoint (RFC 7644)", description: "POST/PATCH/DELETE users with filter parsing.",
    column: "todo", priority: "high", assignee: m(3), labels: ["backend"], estimate: 8, projectId: "p_1", discipline: "engineering",
    links: { prdId: "d_pm_1", featureRequestId: "fr_2" }, createdAt: ago(days(3)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_5", key: "SSO-16", title: "Connect-provider stepper UI", description: "5-step guided SAML connection flow.",
    column: "in-progress", priority: "high", assignee: m(4), labels: ["frontend", "design"], estimate: 5, projectId: "p_1", discipline: "design",
    links: { prdId: "d_pm_1", }, createdAt: ago(days(3)), updatedAt: ago(hours(5)),
  },
  {
    id: "tk_6", key: "SSO-17", title: "Attribute mapping screen", description: "Map IdP claims to Orbit fields and roles.",
    column: "todo", priority: "medium", assignee: m(4), labels: ["frontend"], estimate: 3, projectId: "p_1", discipline: "design",
    links: { prdId: "d_pm_1", }, createdAt: ago(days(2)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_7", key: "SSO-18", title: "Fix: SCIM deactivate must revoke sessions < 5m", description: "Test tc_5 failing — sessions persist after deprovision.",
    column: "review", priority: "urgent", assignee: m(3), labels: ["bug", "security"], estimate: 3, projectId: "p_1", discipline: "qa",
    links: {}, createdAt: ago(days(1)), updatedAt: ago(hours(1)),
  },
  {
    id: "tk_8", key: "SSO-19", title: "Conformance suite: Okta + Azure AD", description: "Automated e2e against IdP sandboxes.",
    column: "todo", priority: "high", assignee: m(5), labels: ["qa", "automation"], estimate: 5, projectId: "p_1", discipline: "qa",
    links: {}, createdAt: ago(days(2)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_9", key: "SSO-20", title: "Enterprise Security sales one-pager", description: "Brief for Hana ahead of Northwind renewal call.",
    column: "review", priority: "high", assignee: m(5), labels: ["sales"], estimate: 2, projectId: "p_1", discipline: "sales",
    links: { meetingId: "m_1" }, createdAt: ago(days(1)), updatedAt: ago(mins(50)),
  },
  {
    id: "tk_10", key: "AUDIT-3", title: "Append-only audit event store", description: "Tamper-evident hash chain on auth + admin events.",
    column: "todo", priority: "high", assignee: m(3), labels: ["backend", "compliance"], estimate: 8, projectId: "p_2", discipline: "engineering",
    links: { prdId: "d_pm_2", meetingId: "m_1" }, createdAt: ago(days(1)), updatedAt: ago(hours(6)),
  },
  {
    id: "tk_11", key: "AUDIT-4", title: "CSV export endpoint", description: "Streamed CSV export with date-range filter.",
    column: "backlog", priority: "medium", assignee: m(3), labels: ["backend"], estimate: 3, projectId: "p_2", discipline: "engineering",
    links: { prdId: "d_pm_2" }, createdAt: ago(days(1)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_12", key: "RBAC-1", title: "Role taxonomy discovery w/ Vertex", description: "Workshop least-privilege roles for 240-seat org.",
    column: "todo", priority: "medium", assignee: m(1), labels: ["product", "research"], estimate: 3, projectId: "p_3", discipline: "product",
    links: { meetingId: "m_2" }, createdAt: ago(days(1)), updatedAt: ago(hours(8)),
  },
  {
    id: "tk_13", key: "RBAC-2", title: "Permission-set data model", description: "Schema for roles, permissions, and group mappings.",
    column: "backlog", priority: "medium", assignee: m(3), labels: ["backend"], estimate: 5, projectId: "p_3", discipline: "engineering",
    links: {}, createdAt: ago(days(1)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_14", key: "ANALYTICS-1", title: "Spike: dashboard query engine options", description: "Evaluate pre-agg vs. live query for native dashboards.",
    column: "backlog", priority: "low", assignee: m(3), labels: ["spike", "analytics"], estimate: 3, projectId: "p_4", discipline: "engineering",
    links: { meetingId: "m_4" }, createdAt: ago(days(1)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_15", key: "SSO-21", title: "Real-time provisioning log table", description: "Live-updating table of SCIM provisioning events.",
    column: "backlog", priority: "medium", assignee: m(4), labels: ["frontend"], estimate: 5, projectId: "p_1", discipline: "design",
    links: { prdId: "d_pm_1", }, createdAt: ago(days(2)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_16", key: "RESIDENCY-1", title: "Blocked: EU region infra scoping", description: "Waiting on infra capacity review before scoping.",
    column: "backlog", priority: "high", assignee: m(2), labels: ["infra", "blocked"], estimate: 8, projectId: "p_5", discipline: "engineering",
    links: { meetingId: "m_3" }, createdAt: ago(days(3)), updatedAt: ago(days(2)),
  },
  {
    id: "tk_17", key: "SSO-22", title: "JIT provisioning worker", description: "Create/update users from first SSO login.",
    column: "todo", priority: "medium", assignee: m(3), labels: ["backend"], estimate: 5, projectId: "p_1", discipline: "engineering",
    links: { prdId: "d_pm_1", }, createdAt: ago(days(2)), updatedAt: ago(days(1)),
  },
  {
    id: "tk_18", key: "SSO-11", title: "Admin connection UI shell", description: "Identity settings overview page.",
    column: "done", priority: "medium", assignee: m(4), labels: ["frontend"], estimate: 3, projectId: "p_1", discipline: "design",
    links: {}, createdAt: ago(days(6)), updatedAt: ago(days(3)),
  },
];

export const taskById = (id: string) => tasks.find((t) => t.id === id);
