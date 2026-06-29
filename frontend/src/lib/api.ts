// ============================================================================
// API layer.
// Defaults to an in-memory mock so the product is fully functional with zero
// backend. Set NEXT_PUBLIC_API_URL to point hooks at the FastAPI backend; the
// response shapes match src/lib/types.ts exactly.
// ============================================================================
import { members, stakeholders } from "./mock/members";
import { agents } from "./mock/agents";
import { meetings } from "./mock/meetings";
import { projects } from "./mock/projects";
import { tasks as allTasks } from "./mock/tasks";
import { executionGraph } from "./mock/graph";
import { timelineEvents } from "./mock/timeline";
import { integrations } from "./mock/integrations";
import {
  activityEvents,
  customerRequests,
  deliveryEstimates,
  followUps,
  revenueTrends,
} from "./mock/activity";
import type {
  ActivityEvent,
  Agent,
  CustomerRequest,
  ExecutionGraph,
  FollowUp,
  Integration,
  Meeting,
  MetricTrend,
  Project,
  Task,
  TimelineEvent,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const USE_MOCK = !API_URL;

/** Simulate realistic network latency for the mock layer. */
const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

async function live<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function liveSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status}`);
  return (res.status === 204 ? (undefined as T) : await res.json()) as T;
}

// --- Meetings --------------------------------------------------------------
export async function getMeetings(): Promise<Meeting[]> {
  if (USE_MOCK) return delay().then(() => meetings);
  return live("/meetings");
}
export async function getMeeting(id: string): Promise<Meeting | undefined> {
  if (USE_MOCK) return delay(180).then(() => meetings.find((x) => x.id === id));
  return live(`/meetings/${id}`);
}

export interface TranscriptRunResult {
  meetingId: string;
  analysis: unknown;
  pipeline: Record<string, unknown>;
}

/** Paste a transcript and run the full agent pipeline. Requires the backend. */
export async function runTranscript(input: {
  transcript: string;
  title?: string;
  account?: string;
}): Promise<TranscriptRunResult> {
  if (USE_MOCK) throw new Error("Transcript analysis needs the backend — set NEXT_PUBLIC_API_URL.");
  const res = await fetch(`${API_URL}/meetings/transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript: input.transcript,
      title: input.title || "Pasted transcript",
      account: input.account || "Manual upload",
    }),
  });
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
  return res.json() as Promise<TranscriptRunResult>;
}

/** Delete a meeting and everything derived from it. Requires the backend. */
export async function deleteMeeting(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(150);
    return;
  }
  const res = await fetch(`${API_URL}/meetings/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

/** Edit the still-draft customer intent / analysis before approval. */
export async function patchMeeting(id: string, body: { analysis?: unknown }): Promise<Meeting | undefined> {
  if (USE_MOCK) return delay(120).then(() => undefined);
  return liveSend(`/meetings/${id}`, "PATCH", body);
}

// --- Agents ----------------------------------------------------------------
export async function getAgents(): Promise<Agent[]> {
  if (USE_MOCK) return delay(220).then(() => agents);
  return live("/agents");
}

// --- Projects --------------------------------------------------------------
export async function getProjects(): Promise<Project[]> {
  if (USE_MOCK) return delay().then(() => projects);
  return live("/projects");
}
export async function getProject(id: string): Promise<Project | undefined> {
  if (USE_MOCK) return delay(180).then(() => projects.find((x) => x.id === id));
  return live(`/projects/${id}`);
}
/** Edit the still-draft artifacts (PRD, follow-up email, timeline, name). */
export async function patchProject(
  id: string,
  body: Partial<{ name: string; prd: unknown; customerUpdate: unknown; timeline: unknown }>,
): Promise<Project | undefined> {
  if (USE_MOCK) return delay(120).then(() => undefined);
  return liveSend(`/projects/${id}`, "PATCH", body);
}
/** Finalize the execution plan (MVP: flips state, no external sync). */
export async function approveExecution(meetingId: string): Promise<{ approvalStatus: string; approvedAt: string } | undefined> {
  if (USE_MOCK) return delay(150).then(() => ({ approvalStatus: "approved", approvedAt: new Date().toISOString() }));
  return liveSend(`/meetings/${meetingId}/approve`, "POST");
}

// --- Tasks -----------------------------------------------------------------
export async function getTasks(): Promise<Task[]> {
  if (USE_MOCK) return delay().then(() => allTasks);
  return live("/tasks");
}
/** Edit / reassign / accept-decline a work item. */
export async function patchTask(
  id: string,
  body: Partial<{ column: string; priority: string; title: string; description: string; assignee: Record<string, unknown>; decision: "accepted" | "declined" }>,
): Promise<Task | undefined> {
  if (USE_MOCK) return delay(120).then(() => undefined);
  return liveSend(`/tasks/${id}`, "PATCH", body);
}
/** Skip / remove a work item from the plan. */
export async function deleteTask(id: string): Promise<void> {
  if (USE_MOCK) return delay(120).then(() => undefined);
  await liveSend(`/tasks/${id}`, "DELETE");
}
/** Push a work item to a connected tool (Jira/Linear). MVP: faked but persisted. */
export async function pushTask(id: string, target: string): Promise<Task | undefined> {
  if (USE_MOCK) return delay(150).then(() => undefined);
  return liveSend(`/tasks/${id}/push`, "POST", { target });
}

// --- Graph -----------------------------------------------------------------
export async function getExecutionGraph(meetingId?: string): Promise<ExecutionGraph> {
  if (USE_MOCK) return delay(240).then(() => executionGraph);
  return live(`/graph${meetingId ? `?meeting_id=${meetingId}` : ""}`);
}

// --- Timeline --------------------------------------------------------------
export async function getTimeline(): Promise<TimelineEvent[]> {
  if (USE_MOCK) {
    return delay().then(() =>
      [...timelineEvents].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    );
  }
  return live("/timeline");
}

// --- Integrations ----------------------------------------------------------
/** Connect / disconnect an integration (only Jira & Linear are wired for the MVP). */
export async function patchIntegration(key: string, status: "connected" | "disconnected"): Promise<Integration | undefined> {
  if (USE_MOCK) return delay(150).then(() => undefined);
  return liveSend(`/integrations/${key}`, "PATCH", { status });
}
export async function getIntegrations(): Promise<Integration[]> {
  if (USE_MOCK) return delay(200).then(() => integrations);
  return live("/integrations");
}

// --- Activity & dashboard rollups -----------------------------------------
export async function getActivity(): Promise<ActivityEvent[]> {
  if (USE_MOCK) return delay(200).then(() => activityEvents);
  return live<ActivityEvent[]>("/activity");
}

export interface DashboardData {
  meetings: Meeting[];
  agents: Agent[];
  projects: Project[];
  followUps: FollowUp[];
  customerRequests: CustomerRequest[];
  revenueTrends: MetricTrend[];
  deliveryEstimates: typeof deliveryEstimates;
  integrations: Integration[];
  activity: ActivityEvent[];
  tasks: Task[];
  timeline: TimelineEvent[];
}

export async function getDashboard(): Promise<DashboardData> {
  if (USE_MOCK) {
    await delay(260);
    return {
      meetings: meetings.slice(0, 4),
      agents,
      projects,
      followUps,
      customerRequests,
      revenueTrends,
      deliveryEstimates,
      integrations,
      activity: activityEvents.slice(0, 6),
      tasks: allTasks,
      timeline: [...timelineEvents].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6),
    };
  }
  return live<DashboardData>("/dashboard");
}

export const directory = { members, stakeholders };
