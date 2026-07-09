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
  CalendarEvent,
  CalendarStatus,
  ChatConversationDetail,
  ChatConversationSummary,
  ChatResponse,
  Customer,
  CustomerRequest,
  KnowledgeItem,
  SyncJob,
  ExecutionGraph,
  FollowUp,
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
const rid = (n = 12) => Math.random().toString(36).slice(2, 2 + n);
const MOCK_DOC_URL: Record<string, () => string> = {
  "google-docs": () => `https://docs.google.com/document/d/${rid(16)}/edit`,
  notion: () => `https://www.notion.so/orbit/${rid(16)}`,
  confluence: () => `https://orbit.atlassian.net/wiki/spaces/PRD/pages/${Math.floor(Math.random() * 9e5 + 1e5)}`,
  linear: () => `https://linear.app/orbit/document/${rid(8)}`,
  jira: () => `https://orbit.atlassian.net/browse/PRD-${Math.floor(Math.random() * 900 + 100)}`,
};

/** Placeholder deep link for a doc destination (used until the real integration exists). */
export function stubDocUrl(target: string): string {
  return (MOCK_DOC_URL[target] ?? MOCK_DOC_URL.linear)();
}

const BOARD_URL: Record<string, () => string> = {
  jira: () => `https://orbit.atlassian.net/jira/software/projects/ORB/boards/1`,
  linear: () => `https://linear.app/orbit/team/ORB/active`,
};
/** Placeholder link to the tracker board after pushing work items (real link later). */
export function stubBoardUrl(target: string): string {
  return (BOARD_URL[target] ?? BOARD_URL.jira)();
}
/** Publish the PRD to a connected doc tool; returns the created doc's deep link.
 *  The actual create-doc call is stubbed until each integration is built. */
export async function publishPrd(projectId: string, target: string): Promise<PrdPublication> {
  if (USE_MOCK) {
    await delay(400);
    return { tool: target, url: stubDocUrl(target), at: new Date().toISOString() };
  }
  return liveSend(`/projects/${projectId}/publish-prd`, "POST", { target });
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

// --- Customers, knowledge, sync & chat ---------------------------------------
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
/** Ask Orbit — grounded in the Context Engine (structured retrieval, no DB dumps).
 *  Conversations persist server-side; pass conversationId to continue one. */
export async function sendChat(
  message: string, customerId?: string | null, conversationId?: string | null,
): Promise<ChatResponse> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return liveSend("/chat", "POST", {
    message, customerId: customerId ?? undefined, conversationId: conversationId ?? undefined,
  });
}
export async function listChatConversations(): Promise<ChatConversationSummary[]> {
  if (USE_MOCK) return [];
  return live("/chat/conversations");
}
export async function getChatConversation(id: string): Promise<ChatConversationDetail> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return live(`/chat/conversations/${id}`);
}
export async function deleteChatConversation(id: string): Promise<void> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  await liveSend(`/chat/conversations/${id}`, "DELETE");
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
