// ============================================================================
// Orbit domain model
// These types are the single source of truth shared by the mock data layer
// and (when wired) the FastAPI backend response shapes.
// ============================================================================

export type ID = string;

export interface Member {
  id: ID;
  name: string;
  email: string;
  avatarUrl?: string;
  role: "Owner" | "Admin" | "Member" | "Viewer";
  title: string;
  status: "active" | "invited" | "offline";
}

export interface Stakeholder {
  id: ID;
  name: string;
  role: string;
  company: string;
  type: "customer" | "internal" | "partner";
  sentiment: Sentiment;
  avatarUrl?: string;
}

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export type Urgency = "critical" | "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export type MeetingSource = "google-meet" | "zoom" | "upload" | "transcript" | "document" | "orbit-call";
export type MeetingStatus = "uploading" | "transcribing" | "analyzing" | "analyzed" | "failed";

export interface TranscriptSegment {
  id: ID;
  speaker: string;
  speakerRole?: string;
  start: number; // seconds
  end: number;
  text: string;
  sentiment?: Sentiment;
}

export interface PainPoint {
  id: ID;
  title: string;
  description: string;
  severity: Urgency;
  frequency: number; // how many times referenced
  quotes: string[];
}

export interface FeatureRequest {
  id: ID;
  title: string;
  description: string;
  demand: number; // 0-100
  effort: "S" | "M" | "L" | "XL";
  category: string;
  linkedProjectId?: ID;
}

export interface BusinessOpportunity {
  id: ID;
  title: string;
  description: string;
  revenueImpact: number;
  confidence: number; // 0-100
  timeframe: string;
  type: "expansion" | "new-logo" | "retention" | "upsell";
}

export interface ActionItem {
  id: ID;
  title: string;
  owner: string;
  due?: string;
  status: "open" | "in-progress" | "done";
  linkedTaskId?: ID;
}

export interface MeetingAnalysis {
  summary: string;
  keyTakeaways: string[];
  sentiment: { overall: Sentiment; score: number; breakdown: { label: string; value: number }[] };
  painPoints: PainPoint[];
  featureRequests: FeatureRequest[];
  opportunities: BusinessOpportunity[];
  actionItems: ActionItem[];
  urgency: Urgency;
  revenueImpact: number;
  topics: { label: string; weight: number }[];
  // Enriched customer intent (optional — older analyses may not include these).
  bugs?: { id: ID; title: string; description: string; severity: Urgency }[];
  customerGoals?: string[];
  deadlines?: { id: ID; title: string; due: string }[];
  requestedIntegrations?: string[];
  confidence?: number; // 0-100
}

export interface Meeting {
  id: ID;
  title: string;
  source: MeetingSource;
  status: MeetingStatus;
  date: string;
  durationSec: number;
  participants: Stakeholder[];
  account: string; // display name — mirrors the linked Customer
  customerId?: ID;
  recordingUrl?: string;
  thumbnailUrl?: string;
  transcript: TranscriptSegment[];
  analysis?: MeetingAnalysis;
  analysisProgress: number; // 0-100
  tags: string[];
  linkedProjectId?: ID;
}

// ---------------------------------------------------------------------------
// AI Agents
// ---------------------------------------------------------------------------

export type AgentKey =
  | "meeting-intelligence"
  | "product-manager"
  | "execution-router"
  | "engineering-planner"
  | "design-planner"
  | "qa-planner"
  | "sales-planner"
  | "execution-planner"
  | "customer-success"
  | "leadership-advisor";

export type AgentStatus = "idle" | "thinking" | "running" | "completed" | "blocked" | "error";

export interface AgentDocument {
  id: ID;
  title: string;
  type: "PRD" | "Spec" | "Plan" | "Report" | "Brief" | "Test Plan" | "Strategy";
  createdAt: string;
  wordCount: number;
  projectId?: ID;
}

export interface AgentRun {
  id: ID;
  step: string;
  detail: string;
  at: string;
  tokens?: number;
}

export interface Agent {
  key: AgentKey;
  name: string;
  role: string;
  description: string;
  model: string;
  status: AgentStatus;
  currentThought?: string;
  confidence: number; // 0-100
  executionTimeSec: number;
  completedTasks: number;
  documents: AgentDocument[];
  recentRuns: AgentRun[];
  color: string;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectStatus = "discovery" | "planning" | "in-progress" | "review" | "shipped" | "blocked";
export type HealthStatus = "on-track" | "at-risk" | "off-track";

export interface PRDSection {
  heading: string;
  body: string;
}

export interface ProjectPRD {
  title?: string;
  problem: string;
  background?: string;
  goals: string[];
  nonGoals: string[];
  functionalRequirements?: string[];
  acceptanceCriteria?: string[];
  dependencies?: string[];
  risks?: string[];
  successMetrics: { metric: string; target: string }[];
  userStories: { id: ID; persona: string; story: string; priority: "P0" | "P1" | "P2" }[];
  sections: PRDSection[];
  generatedBy: AgentKey;
  updatedAt: string;
  // Where this PRD was published after approval (Linear / Google Docs / Confluence), with a deep link back.
  publication?: { tool: IntegrationKey; url: string; at: string };
}

export interface CustomerUpdate {
  to?: string; // recipient — auto-filled from the customer's learned contact
  subject?: string;
  body?: string;
  commitments?: string[];
  skipped?: boolean;
  reason?: string;
}

export interface ExecutionTimeline {
  durationWeeks: number;
  milestones: { title: string; week: number; description: string }[];
  criticalPath: string[];
  deliveryEstimate: string;
  confidence: number; // 0-100
}

export interface EngineeringPlan {
  architecture: string;
  components: { name: string; description: string; status: "todo" | "in-progress" | "done" }[];
  apis: { method: string; path: string; description: string }[];
  risks: { risk: string; mitigation: string; severity: Urgency }[];
  estimateWeeks: number;
  techStack: string[];
}

export interface DesignPlan {
  summary: string;
  flows: { name: string; steps: string[] }[];
  screens: { name: string; description: string; status: "todo" | "in-progress" | "done" }[];
  principles: string[];
  components: string[];
}

export interface QAPlan {
  strategy: string;
  testCases: { id: ID; title: string; type: "unit" | "integration" | "e2e" | "manual"; status: "pass" | "fail" | "pending" }[];
  coverage: number;
  risks: string[];
}

export interface SalesPlan {
  positioning: string;
  targetSegments: string[];
  talkingPoints: string[];
  pricing: { tier: string; price: string; features: string[] }[];
  pipeline: { account: string; value: number; stage: string }[];
}

export interface Project {
  id: ID;
  name: string;
  key: string; // e.g. ORB
  description: string;
  status: ProjectStatus;
  health: HealthStatus;
  progress: number; // 0-100
  owner: Member;
  team: Member[];
  startDate: string;
  targetDate: string;
  deliveryEstimate: string;
  sourceMeetingId?: ID;
  customerId?: ID;
  revenueImpact: number;
  tags: string[];
  prd?: ProjectPRD;
  crmUpdate?: CRMUpdate;
  engineering?: EngineeringPlan;
  design?: DesignPlan;
  qa?: QAPlan;
  sales?: SalesPlan;
  customerUpdate?: CustomerUpdate;
  timeline?: ExecutionTimeline;
  internalNotes?: string;
  approvalStatus?: "draft" | "approved";
  approvedAt?: string;
  documents: AgentDocument[];
}

/** Proposed CRM record update — reviewed, approved, then synced. */
export interface CRMUpdate {
  accountSummary?: string;
  opportunityStage?: string;
  riskLevel?: "low" | "medium" | "high" | string;
  nextSteps?: string[];
  fieldUpdates?: { field: string; value: string; reason: string }[];
  skipped?: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Customers, knowledge & synchronization
// ---------------------------------------------------------------------------

export interface Customer {
  id: ID;
  name: string;
  domains: string[];
  aliases: string[];
  createdAt: string;
  meetingCount: number;
  planCount: number;
  approvedPlanCount: number;
  openCommitments: number;
  lastMeetingAt?: string | null;
}

export type KnowledgeKind =
  | "meeting-summary" | "crm-update" | "prd" | "timeline" | "follow-up-email" | "commitment";

export interface KnowledgeItem {
  id: ID;
  customerId: ID;
  kind: KnowledgeKind;
  title: string;
  content: Record<string, unknown>;
  status: "active" | "open" | "completed";
  sourceMeetingId?: string | null;
  sourcePlanId?: string | null;
  approvedAt?: string | null;
  createdAt: string;
}

export interface SyncJob {
  id: ID;
  planId: ID;
  customerId?: ID | null;
  kind: "crm-update" | "publish-prd" | "create-tasks" | "send-email";
  destination: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface Insight {
  id: ID;
  customerId?: string | null;
  kind: "risk" | "gap" | "trend" | "win" | "brief";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
}

export interface Goal {
  id: ID;
  title: string;
  detail: string;
  targetDate?: string | null;
  status: "open" | "achieved" | "dropped";
  createdAt: string;
}

export interface HeartbeatStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: string | null;
  lastFound: number;
  lastBriefAt?: string | null;
  ticks: number;
}

// ---------------------------------------------------------------------------
// Tasks (Kanban)
// ---------------------------------------------------------------------------

export type TaskColumn = "backlog" | "todo" | "in-progress" | "review" | "done";
export type TaskPriority = "urgent" | "high" | "medium" | "low";

export interface Task {
  id: ID;
  key: string; // ORB-123
  title: string;
  description: string;
  column: TaskColumn;
  priority: TaskPriority;
  assignee?: Member;
  labels: string[];
  estimate?: number; // points
  projectId?: ID;
  discipline: "engineering" | "design" | "qa" | "product" | "sales" | "customer-success";
  links: {
    meetingId?: ID;
    featureRequestId?: ID;
    prdId?: ID;
    graphNodeId?: ID;
    reason?: string;
    confidence?: number;
    decision?: "accepted" | "declined";
    pushed?: boolean;
    pushedTo?: string;
    externalKey?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineKind =
  | "meeting-uploaded"
  | "transcript-ready"
  | "ai-analysis"
  | "prd-generated"
  | "engineering-planned"
  | "tasks-created"
  | "review-approved"
  | "development-started"
  | "qa"
  | "deployment"
  | "customer-updated";

export interface TimelineEvent {
  id: ID;
  kind: TimelineKind;
  title: string;
  description: string;
  at: string;
  actor: string;
  agent?: AgentKey;
  projectId?: ID;
  meetingId?: ID;
  meta?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export type IntegrationKey =
  | "google-meet"
  | "zoom"
  | "slack"
  | "github"
  | "jira"
  | "linear"
  | "notion"
  | "hubspot"
  | "salesforce"
  | "calendar"
  | "gong"
  | "intercom"
  | "asana"
  | "confluence"
  | "google-docs";

export type IntegrationStatus = "connected" | "disconnected" | "error" | "syncing" | "coming-soon";

export interface Integration {
  key: IntegrationKey;
  name: string;
  category: "Conferencing" | "Communication" | "Engineering" | "Product" | "CRM" | "Calendar" | "Support";
  description: string;
  status: IntegrationStatus;
  lastSync?: string;
  account?: string;
  stats?: { label: string; value: string }[];
}

// ---------------------------------------------------------------------------
// Google Calendar (read-only sync)
// ---------------------------------------------------------------------------

export interface CalendarStatus {
  configured: boolean; // GOOGLE_CLIENT_ID/SECRET present on the backend
  connected: boolean;
  email?: string | null;
}

export interface CalendarEvent {
  id: ID;
  title: string;
  start: string | null;
  end: string | null;
  attendees: { email: string; name: string }[];
  meetLink?: string | null;
  htmlLink?: string | null;
}

export interface ZoomRecording {
  uuid: string;
  topic: string;
  startTime?: string | null;
  durationMin: number;
  hasTranscript: boolean;
  meetingId?: string | null; // set once imported into Orbit
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: ID;
  actor: { name: string; avatarUrl?: string; isAgent?: boolean };
  action: string;
  target: string;
  targetType: "meeting" | "project" | "task" | "document" | "integration" | "agent";
  at: string;
  projectId?: ID;
}

// ---------------------------------------------------------------------------
// Dashboard rollups
// ---------------------------------------------------------------------------

export interface FollowUp {
  id: ID;
  title: string;
  account: string;
  due: string;
  owner: Member;
  priority: TaskPriority;
}

export interface CustomerRequest {
  id: ID;
  account: string;
  request: string;
  demand: number;
  revenueImpact: number;
  status: "new" | "triaged" | "planned" | "shipped";
  at: string;
}

export interface MetricTrend {
  label: string;
  value: string;
  delta: number; // percent
  spark: number[];
}
