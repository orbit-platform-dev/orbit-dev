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

export type MeetingSource = "google-meet" | "zoom" | "upload" | "transcript";
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
  account: string;
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
  | "engineering-planner"
  | "design-planner"
  | "qa-planner"
  | "sales-planner"
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
}

export interface CustomerUpdate {
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
  revenueImpact: number;
  tags: string[];
  prd?: ProjectPRD;
  engineering?: EngineeringPlan;
  design?: DesignPlan;
  qa?: QAPlan;
  sales?: SalesPlan;
  customerUpdate?: CustomerUpdate;
  timeline?: ExecutionTimeline;
  approvalStatus?: "draft" | "approved";
  approvedAt?: string;
  documents: AgentDocument[];
}

// ---------------------------------------------------------------------------
// Execution graph
// ---------------------------------------------------------------------------

export type GraphNodeKind =
  | "meeting"
  | "business-goal"
  | "feature-request"
  | "customer-intent"
  | "prd"
  | "execution-plan"
  | "engineering"
  | "design"
  | "qa"
  | "sales"
  | "timeline"
  | "deployment"
  | "customer-followup";

export type GraphNodeStatus = "completed" | "active" | "pending" | "blocked" | "skipped";

export interface GraphNodeHistory {
  at: string;
  event: string;
  actor: string;
}

export interface ExecutionNode {
  id: ID;
  kind: GraphNodeKind;
  title: string;
  subtitle: string;
  status: GraphNodeStatus;
  agent?: AgentKey;
  progress: number;
  owner?: string;
  projectId?: ID;
  meta: Record<string, string | number>;
  history: GraphNodeHistory[];
}

export interface ExecutionEdge {
  id: ID;
  source: ID;
  target: ID;
  animated: boolean;
  label?: string;
}

export interface ExecutionGraph {
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
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
  | "calendar";

export type IntegrationStatus = "connected" | "disconnected" | "error" | "syncing";

export interface Integration {
  key: IntegrationKey;
  name: string;
  category: "Conferencing" | "Communication" | "Engineering" | "Product" | "CRM" | "Calendar";
  description: string;
  status: IntegrationStatus;
  lastSync?: string;
  account?: string;
  stats?: { label: string; value: string }[];
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
