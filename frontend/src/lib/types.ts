// ============================================================================
// Orbit domain model (MVP)
// The single source of truth shared by the API layer and the UI. Mirrors the
// backend's camelCase response shapes.
// ============================================================================

export type ID = string;

// ---------------------------------------------------------------------------
// Memory — artifacts (Observe + Remember)
// ---------------------------------------------------------------------------
export interface ArtifactExtraction {
  summary?: string;
  commitments?: { text: string; to?: string; due?: string }[];
  requests?: string[];
  decisions?: string[];
  status?: string;
  entities?: { name: string; kind: string }[];
}

export interface Artifact {
  id: ID;
  source: string; // call | linear-issue | document
  kind: string;
  externalRef?: string | null;
  url?: string | null;
  title: string;
  content?: string;
  extracted?: ArtifactExtraction | null;
  status: string;
  occurredAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Company model — entities + links (Understand)
// ---------------------------------------------------------------------------
export type EntityKind = "customer" | "commitment" | "feature" | "person" | "goal";

export interface Entity {
  id: ID;
  kind: string;
  name: string;
  state: string; // commitment: open | tracked | delivered
  meta?: {
    to?: string;
    due?: string;
    linear?: { identifier?: string; url?: string };
    [k: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MemoryFact {
  id: ID;
  fact: string;
  kind: string;
  confidence: number;
  status: string; // active | superseded | stale
  sourceRef: string;
  sourceArtifactId?: string | null;
}

export interface EntityDetail {
  entity: Entity;
  artifacts: { type: string; artifact: Artifact }[];
  relatedEntities: { type: string; entity: Entity }[];
  facts: MemoryFact[];
}

// ---------------------------------------------------------------------------
// Feed — findings + recommendations (Reason, Recommend, Approve)
// ---------------------------------------------------------------------------
export type FindingKind = "gap" | "drift" | "trend" | "win";

export interface FindingAction {
  type: string;
  target?: string;
  title?: string;
  description?: string;
  result?: { identifier?: string; url?: string };
}

export interface Finding {
  id: ID;
  kind: string;
  title: string;
  detail: string;
  status: string; // open | approved | dismissed | resolved
  action?: FindingAction | null;
  entities: Entity[];
  artifacts: Artifact[];
  createdAt: string;
}

export interface Brief {
  id: ID;
  title: string;
  detail: string;
  evidence: { risks?: string[]; highlights?: string[]; recommendations?: string[] };
  createdAt: string;
}

export interface Feed {
  brief: Brief | null;
  findings: Finding[];
}

// One captured human correction (edit or dismissal) that shapes future output (Learn).
export interface Correction {
  id: ID;
  section: string;
  field: string;
  before: string;
  after: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Connectors + system status
// ---------------------------------------------------------------------------
export type IntegrationStatus =
  "connected" | "disconnected" | "syncing" | "coming-soon" | "reconnect" | "error";
export type IntegrationKey = string;

export interface Integration {
  key: IntegrationKey;
  name: string;
  category: string;
  description: string;
  status: IntegrationStatus;
  lastSync?: string | null;
  account?: string | null;
  stats?: unknown[] | null;
  connectable?: boolean;
  oauthAvailable?: boolean;
  liveEvents?: boolean;
  canEnableLive?: boolean;
}
export interface MemoryCounts {
  artifacts: number;
  bySource: Record<string, number>;
  entities: number;
  facts: number;
  insights: number;
}

export interface SyncProgress {
  active: boolean;
  phase: "reading" | "reasoning" | "done" | "error";
  trigger: string;
  message: string;
  counts: Partial<Record<"issues" | "calls" | "customers" | "commitments" | "findings", number>>;
  startedAt: string;
  finishedAt: string | null;
}

export interface HeartbeatStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastFound: number;
  lastBriefAt: string | null;
  ticks: number;
  sync?: SyncProgress | null;
}

export interface ChatCitation {
  id: ID;
  source: string;
  title: string;
  url?: string | null;
}

export interface ChatDraft {
  actionId: string;
  type: string;
  connector: "linear" | "github" | string;
  title: string;
  description: string;
  target?: string | null;
  targetLabel?: string | null;
  status: "pending" | "created" | "discarded";
  result?: { identifier?: string; url?: string } | null;
  proactive?: boolean;
}

export interface TicketTargets {
  linear: { id: string; name: string; key?: string }[];
  github: { fullName: string }[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  grounded?: boolean;
  draft?: ChatDraft | null;
  rating?: "up" | "down" | null;
}

export interface ChatAnswer {
  conversationId: ID;
  answer: string;
  citations: ChatCitation[];
  grounded: boolean;
  draft?: ChatDraft | null;
}

export interface ChatConversationSummary {
  id: ID;
  title: string;
  updatedAt: string;
}

export interface ChatConversationDetail {
  id: ID;
  title: string;
  messages: ChatMessage[];
}
