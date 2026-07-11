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
  Insight,
  CalendarEvent,
  CalendarStatus,
  Customer,
  CustomerRequest,
  KnowledgeItem,
  SyncJob,
  FollowUp,
  Goal,
  HeartbeatStatus,
  Integration,
  Meeting,
  MetricTrend,
  Project,
  Task,
  TimelineEvent,
  ZoomRecording,
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
  status: string;
}

/** Paste a transcript and start analysis in the background. Returns immediately with
 *  the new meeting id; poll the meeting to watch progress. Requires the backend. */
export async function runTranscript(input: {
  transcript: string;
  title?: string;
  account?: string;
  source?: "transcript" | "document";
}): Promise<TranscriptRunResult> {
  if (USE_MOCK) throw new Error("Transcript analysis needs the backend — set NEXT_PUBLIC_API_URL.");
  const res = await fetch(`${API_URL}/meetings/transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript: input.transcript,
      title: input.title || "Pasted transcript",
      account: input.account || "Manual upload",
      source: input.source || "transcript",
    }),
  });
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
  return res.json() as Promise<TranscriptRunResult>;
}

/** Re-run analysis over a stored meeting (background). Requires the backend. */
export async function analyzeMeeting(id: string): Promise<{ meetingId: string; status: string } | undefined> {
  if (USE_MOCK) return delay(150).then(() => undefined);
  return liveSend(`/meetings/${id}/analyze`, "POST");
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
  body: Partial<{ name: string; prd: unknown; crmUpdate: unknown; customerUpdate: unknown; timeline: unknown; internalNotes: string }>,
): Promise<Project | undefined> {
  if (USE_MOCK) return delay(120).then(() => undefined);
  return liveSend(`/projects/${id}`, "PATCH", body);
}
/** Generate the PRD on demand — none exists until the user asks for one. */
export async function generatePrd(projectId: string): Promise<Project> {
  if (USE_MOCK) throw new Error("PRD generation needs the backend — set NEXT_PUBLIC_API_URL.");
  return liveSend(`/projects/${projectId}/generate-prd`, "POST");
}
/** Approve the execution plan: locks it, updates knowledge, prepares sync jobs. */
export async function approveExecution(meetingId: string): Promise<{ approvalStatus: string; approvedAt: string } | undefined> {
  if (USE_MOCK) return delay(150).then(() => ({ approvalStatus: "approved", approvedAt: new Date().toISOString() }));
  return liveSend(`/meetings/${meetingId}/approve`, "POST");
}

export interface PrdPublication {
  tool: string;
  url: string;
  at: string;
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
/** Create this work item as a real Linear issue (other trackers are on the roadmap). */
export async function pushTask(id: string, target: string): Promise<Task | undefined> {
  if (USE_MOCK) return delay(150).then(() => undefined);
  return liveSend(`/tasks/${id}/push`, "POST", { target });
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

// --- Customers, knowledge & sync ---------------------------------------------
export async function getCustomers(): Promise<Customer[]> {
  if (USE_MOCK) return [];
  return live("/customers");
}
export async function getCustomer(id: string): Promise<Customer> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return live(`/customers/${id}`);
}
export async function createCustomer(input: { name: string; domain?: string; contactEmail?: string }): Promise<Customer> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/customers", "POST", input);
}
export async function patchKnowledge(itemId: string, status: "open" | "completed"): Promise<KnowledgeItem> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend(`/customers/knowledge/${itemId}`, "PATCH", { status });
}
/** Removes the customer and their knowledge; signals/proposals survive unlinked. */
export async function deleteCustomer(id: string): Promise<void> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  await liveSend(`/customers/${id}`, "DELETE");
}
export async function getCustomerKnowledge(id: string, kind?: string): Promise<KnowledgeItem[]> {
  if (USE_MOCK) return [];
  return live(`/customers/${id}/knowledge${kind ? `?kind=${kind}` : ""}`);
}
/** Synchronization status per destination — prepared at approval, run explicitly. */
export async function getSyncJobs(planId: string): Promise<SyncJob[]> {
  if (USE_MOCK) return [];
  return live(`/projects/${planId}/sync-jobs`);
}
/** Explicitly execute one prepared update (Send / Publish / Create issues / Sync CRM). */
export async function runSyncJob(planId: string, jobId: string, to?: string): Promise<SyncJob> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend(`/projects/${planId}/sync-jobs/${jobId}/run`, "POST", { to: to || undefined });
}
// --- Company intelligence -----------------------------------------------------
export async function getInsights(status?: string): Promise<Insight[]> {
  if (USE_MOCK) return [];
  return live(`/insights${status ? `?status=${status}` : ""}`);
}
/** Run the gap/risk/trend detectors now (idempotent). */
export async function scanInsights(): Promise<Insight[]> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/insights/scan", "POST");
}
/** Generate the company intelligence brief from current context. */
export async function generateBrief(): Promise<Insight> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/insights/brief", "POST");
}
export async function getHeartbeat(): Promise<HeartbeatStatus> {
  return live("/insights/heartbeat");
}
export async function getGoals(): Promise<Goal[]> {
  return live("/goals");
}
export async function createGoal(body: { title: string; detail?: string; targetDate?: string | null }): Promise<Goal> {
  return liveSend("/goals", "POST", body);
}
export async function patchGoal(id: string, body: Partial<{ title: string; detail: string; targetDate: string | null; status: Goal["status"] }>): Promise<Goal> {
  return liveSend(`/goals/${id}`, "PATCH", body);
}
export async function deleteGoal(id: string): Promise<void> {
  await liveSend(`/goals/${id}`, "DELETE");
}
export async function patchInsight(id: string, status: Insight["status"]): Promise<Insight> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend(`/insights/${id}`, "PATCH", { status });
}
/** Connect Linear with a personal API key — validated live against Linear. */
export async function connectLinear(apiKey: string): Promise<Integration> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/integrations/linear/connect", "POST", { apiKey });
}
export async function disconnectLinear(): Promise<Integration> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/integrations/linear/disconnect", "POST");
}

// --- Google Calendar (read-only sync) + Zoom ---------------------------------
// All real — these need the backend (and Google OAuth creds for calendar).
const NEEDS_BACKEND = "This needs the backend — set NEXT_PUBLIC_API_URL.";

export async function getCalendarStatus(): Promise<CalendarStatus> {
  if (USE_MOCK) return { configured: false, connected: false };
  return live("/calendar/status");
}
/** URL of Google's consent screen; navigate the browser there to connect. */
export async function getCalendarAuthUrl(): Promise<{ url: string }> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  const res = await fetch(`${API_URL}/calendar/connect`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `Connect failed: ${res.status}`);
  return res.json();
}
export async function disconnectCalendar(): Promise<void> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  await liveSend("/calendar/disconnect", "POST");
}
/** Events in a window (ISO timeMin + days) — powers the week view's ‹ › paging. */
export async function getCalendarEvents(timeMin?: string, days = 7): Promise<CalendarEvent[]> {
  if (USE_MOCK) return [];
  const params = new URLSearchParams({ days: String(days) });
  if (timeMin) params.set("time_min", timeMin);
  return live(`/calendar/events?${params}`);
}
// Zoom: real OAuth; recordings' transcripts import into Meetings.
export async function getZoomStatus(): Promise<CalendarStatus> {
  if (USE_MOCK) return { configured: false, connected: false };
  return live("/zoom/status");
}
export async function getZoomAuthUrl(): Promise<{ url: string }> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  const res = await fetch(`${API_URL}/zoom/connect`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `Connect failed: ${res.status}`);
  return res.json();
}
export async function disconnectZoom(): Promise<void> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  await liveSend("/zoom/disconnect", "POST");
}
export async function getZoomRecordings(): Promise<ZoomRecording[]> {
  if (USE_MOCK) return [];
  return live("/zoom/recordings");
}
export async function importZoomRecording(uuid: string): Promise<{ meetingId: string; status: string }> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/zoom/recordings/import", "POST", { uuid });
}

// Google Meet: real OAuth (same Google client as Calendar); conference-record
// transcripts import into Meetings, shaped like Zoom's recording summaries.
export async function getMeetStatus(): Promise<CalendarStatus> {
  if (USE_MOCK) return { configured: false, connected: false };
  return live("/meet/status");
}
export async function getMeetAuthUrl(): Promise<{ url: string }> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  const res = await fetch(`${API_URL}/meet/connect`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `Connect failed: ${res.status}`);
  return res.json();
}
export async function disconnectMeet(): Promise<void> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  await liveSend("/meet/disconnect", "POST");
}
export async function getMeetRecordings(): Promise<ZoomRecording[]> {
  if (USE_MOCK) return [];
  return live("/meet/recordings");
}
export async function importMeetRecording(uuid: string, account?: string): Promise<{ meetingId: string; status: string }> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/meet/recordings/import", "POST", { uuid, account: account || undefined });
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
