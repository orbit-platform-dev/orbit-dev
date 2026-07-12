// ============================================================================
// API layer (MVP). Talks to the FastAPI backend at NEXT_PUBLIC_API_URL.
// Response shapes match src/lib/types.ts exactly.
// ============================================================================
import type {
  Artifact,
  Correction,
  Entity,
  EntityDetail,
  Feed,
  Finding,
  HeartbeatStatus,
  Integration,
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
export const connectLinear = (apiKey: string) =>
  send<Integration>("/integrations/linear/connect", "POST", { apiKey });
export const disconnectIntegration = (key: string) =>
  send<Integration>(`/integrations/${key}/disconnect`, "POST");
// Mint an authenticated, workspace-bound authorize URL, then redirect the browser
// to it. The workspace is derived server-side from the signed-in user.
export const getOAuthUrl = (key: string) =>
  send<{ url: string }>(`/integrations/${key}/oauth/url`, "POST");
