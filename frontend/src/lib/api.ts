// ============================================================================
// API layer (MVP). Talks to the FastAPI backend at NEXT_PUBLIC_API_URL.
// Response shapes match src/lib/types.ts exactly.
// ============================================================================
import type {
  Artifact,
  ChatAnswer,
  ChatConversationDetail,
  ChatConversationSummary,
  ChatDraft,
  Correction,
  Entity,
  EntityDetail,
  Feed,
  Finding,
  HeartbeatStatus,
  Integration,
  MemoryCounts,
  TicketTargets,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const NEEDS_BACKEND = "This needs the backend — set NEXT_PUBLIC_API_URL.";

async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = await (window as any).Clerk?.session?.getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function live<T>(path: string): Promise<T> {
  if (!API_URL) throw new Error(NEEDS_BACKEND);
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function send<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  if (!API_URL) throw new Error(NEEDS_BACKEND);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.detail;
    throw new Error(detail || `API ${method} ${path} failed: ${res.status}`);
  }
  return (res.status === 204 ? (undefined as T) : await res.json()) as T;
}

// --- Memory (Observe + Remember) -------------------------------------------
export const getArtifacts = () => live<Artifact[]>("/artifacts");
export const getMemoryCounts = () => live<MemoryCounts>("/artifacts/counts");
export const getArtifact = (id: string) => live<Artifact>(`/artifacts/${id}`);
export const ingestCall = (input: { title?: string; content: string; source?: string }) =>
  send<Artifact>("/artifacts", "POST", {
    title: input.title || "Customer call",
    content: input.content,
    source: input.source || "call",
  });
export const pullArtifacts = () =>
  send<{ ingested: number; bySource: Record<string, number> }>("/artifacts/pull", "POST");

// --- Company model (Understand) --------------------------------------------
export const getEntities = (kind?: string) =>
  live<Entity[]>(`/entities${kind ? `?kind=${kind}` : ""}`);
export const getEntity = (id: string) => live<EntityDetail>(`/entities/${id}`);

export const sendChat = (body: { message: string; conversationId?: string | null }) =>
  send<ChatAnswer>("/chat", "POST", body);

export interface FeedbackInput {
  category: "bug" | "feature" | "other";
  description: string;
  email?: string;
  image?: string | null;      
  imageName?: string | null;
}
export const submitFeedback = (body: FeedbackInput) =>
  send<{ identifier: string; url: string }>("/feedback", "POST", body);

export const getTicketTargets = () => live<TicketTargets>("/chat/ticket-targets");
export const editChatAction = (
  cid: string,
  actionId: string,
  patch: Partial<{ title: string; description: string; connector: string; target: string; targetLabel: string; discard: boolean }>,
) => send<ChatDraft>(`/chat/conversations/${cid}/actions/${actionId}`, "PATCH", patch);
export const approveChatAction = (cid: string, actionId: string) =>
  send<{ actionId: string; status: string; result: { identifier?: string; url?: string } }>(
    `/chat/conversations/${cid}/actions/${actionId}/approve`,
    "POST",
  );
export const rateChatAnswer = (cid: string, index: number, rating: "up" | "down") =>
  send<{ index: number; rating: string }>(`/chat/conversations/${cid}/messages/${index}/rate`, "POST", { rating });

export interface ChatStreamHandlers {
  onPhase?: (phase: string, connector?: string) => void;
  onThinking?: (text: string) => void;
  onDelta: (text: string) => void;
  onDraft?: (draft: ChatDraft) => void;
  onDone: (final: ChatAnswer) => void;
  onError: (message: string) => void;
}

// Token-streamed answer (SSE over fetch). Abort via `signal` stops generation;
// an aborted stream is not persisted server-side.
export async function streamChat(
  body: { message: string; conversationId?: string | null },
  h: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!API_URL) {
    h.onError(NEEDS_BACKEND);
    return;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name !== "AbortError") h.onError("Couldn't reach Orbit. Is the backend running?");
    return;
  }
  if (!res.ok || !res.body) {
    const detail = (await res.json().catch(() => null))?.detail;
    h.onError(detail || `Chat failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const ev of events) {
        const line = ev.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (data.type === "delta") h.onDelta(data.text as string);
        else if (data.type === "thinking") h.onThinking?.(data.text as string);
        else if (data.type === "phase") h.onPhase?.(data.phase as string, data.connector as string | undefined);
        else if (data.type === "draft") h.onDraft?.(data.draft as ChatDraft);
        else if (data.type === "error") h.onError(data.message as string);
        else if (data.type === "done")
          h.onDone({
            conversationId: data.conversationId as string,
            answer: "",
            citations: (data.citations ?? []) as ChatAnswer["citations"],
            grounded: (data.grounded ?? true) as boolean,
            draft: (data.draft ?? null) as ChatAnswer["draft"],
          });
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") h.onError("The connection dropped mid-answer.");
  }
}
export const listChatConversations = () => live<ChatConversationSummary[]>("/chat/conversations");
export const getChatConversation = (id: string) => live<ChatConversationDetail>(`/chat/conversations/${id}`);
export const deleteChatConversation = (id: string) => send<void>(`/chat/conversations/${id}`, "DELETE");

// --- Feed (Reason, Recommend, Approve, Learn) ------------------------------
export const getFeed = () => live<Feed>("/feed");
// Kicks off an immediate read + reason; progress streams via GET /heartbeat.
export const scanFeed = () => send<HeartbeatStatus>("/feed/scan", "POST");
export const approveFinding = (id: string) => send<Finding>(`/findings/${id}/approve`, "POST");
export const editFinding = (id: string, body: { title?: string; description?: string }) =>
  send<Finding>(`/findings/${id}/edit`, "POST", body);
export const dismissFinding = (id: string, reason?: string) =>
  send<Finding>(`/findings/${id}/dismiss`, "POST", { reason: reason || "" });
export const getLearning = () => live<Correction[]>("/learning");

// --- System ----------------------------------------------------------------
export const getHeartbeat = () => live<HeartbeatStatus>("/heartbeat");
export const setAutoSync = (enabled: boolean) =>
  send<HeartbeatStatus>("/heartbeat/auto", "POST", { enabled });

// --- Connectors ------------------------------------------------------------
export const getIntegrations = () => live<Integration[]>("/integrations");
export const connectWithKey = (key: string, apiKey: string) =>
  send<Integration>(`/integrations/${key}/connect`, "POST", { apiKey });
export const disconnectIntegration = (key: string) =>
  send<Integration>(`/integrations/${key}/disconnect`, "POST");
// Mint an authenticated, workspace-bound authorize URL, then redirect the browser
// to it. The workspace is derived server-side from the signed-in user.
export const getOAuthUrl = (key: string) =>
  send<{ url: string }>(`/integrations/${key}/oauth/url`, "POST");
// Mint (once) this workspace's inbound webhook URL for a connector — used by
// push-based connectors like Circleback, which deliver meetings to this URL.
export const getWebhookUrl = (key: string) =>
  live<{ url: string; note: string }>(`/integrations/${key}/webhook`);
