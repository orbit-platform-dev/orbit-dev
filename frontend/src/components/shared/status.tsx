import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type {
  AgentStatus,
  GraphNodeStatus,
  HealthStatus,
  IntegrationStatus,
  ProjectStatus,
  Sentiment,
  TaskPriority,
  Urgency,
} from "@/lib/types";

type Variant = "default" | "secondary" | "outline" | "success" | "warning" | "info" | "destructive" | "muted";

// --- Generic colored dot -----------------------------------------------------
export function StatusDot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", className)} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", className)} />
    </span>
  );
}

// --- Project status ----------------------------------------------------------
const projectStatusMeta: Record<ProjectStatus, { label: string; variant: Variant }> = {
  discovery: { label: "Discovery", variant: "muted" },
  planning: { label: "Planning", variant: "info" },
  "in-progress": { label: "In Progress", variant: "default" },
  review: { label: "In Review", variant: "warning" },
  shipped: { label: "Shipped", variant: "success" },
  blocked: { label: "Blocked", variant: "destructive" },
};
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const m = projectStatusMeta[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// --- Health ------------------------------------------------------------------
const healthMeta: Record<HealthStatus, { label: string; variant: Variant; dot: string }> = {
  "on-track": { label: "On track", variant: "success", dot: "bg-success" },
  "at-risk": { label: "At risk", variant: "warning", dot: "bg-warning" },
  "off-track": { label: "Off track", variant: "destructive", dot: "bg-destructive" },
};
export function HealthBadge({ health }: { health: HealthStatus }) {
  const m = healthMeta[health];
  return (
    <Badge variant={m.variant}>
      <StatusDot className={m.dot} />
      {m.label}
    </Badge>
  );
}

// --- Agent status ------------------------------------------------------------
export const agentStatusMeta: Record<AgentStatus, { label: string; variant: Variant; dot: string; pulse: boolean }> = {
  idle: { label: "Idle", variant: "muted", dot: "bg-muted-foreground", pulse: false },
  thinking: { label: "Thinking", variant: "info", dot: "bg-info", pulse: true },
  running: { label: "Running", variant: "default", dot: "bg-primary", pulse: true },
  completed: { label: "Completed", variant: "success", dot: "bg-success", pulse: false },
  blocked: { label: "Blocked", variant: "warning", dot: "bg-warning", pulse: false },
  error: { label: "Error", variant: "destructive", dot: "bg-destructive", pulse: false },
};
export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const m = agentStatusMeta[status];
  return (
    <Badge variant={m.variant}>
      <StatusDot className={m.dot} pulse={m.pulse} />
      {m.label}
    </Badge>
  );
}

// --- Priority ----------------------------------------------------------------
const priorityMeta: Record<TaskPriority, { label: string; variant: Variant }> = {
  urgent: { label: "Urgent", variant: "destructive" },
  high: { label: "High", variant: "warning" },
  medium: { label: "Medium", variant: "info" },
  low: { label: "Low", variant: "muted" },
};
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const m = priorityMeta[priority];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// --- Urgency -----------------------------------------------------------------
const urgencyMeta: Record<Urgency, { label: string; variant: Variant }> = {
  critical: { label: "Critical", variant: "destructive" },
  high: { label: "High", variant: "warning" },
  medium: { label: "Medium", variant: "info" },
  low: { label: "Low", variant: "muted" },
};
export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const m = urgencyMeta[urgency?.toLowerCase() as Urgency] ?? urgencyMeta.medium;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// --- Sentiment ---------------------------------------------------------------
const sentimentMeta: Record<Sentiment, { label: string; variant: Variant; dot: string }> = {
  positive: { label: "Positive", variant: "success", dot: "bg-success" },
  neutral: { label: "Neutral", variant: "muted", dot: "bg-muted-foreground" },
  negative: { label: "Negative", variant: "destructive", dot: "bg-destructive" },
  mixed: { label: "Mixed", variant: "warning", dot: "bg-warning" },
};
export function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const m = sentimentMeta[sentiment?.toLowerCase() as Sentiment] ?? sentimentMeta.neutral;
  return (
    <Badge variant={m.variant}>
      <StatusDot className={m.dot} />
      {m.label}
    </Badge>
  );
}

// --- Integration status ------------------------------------------------------
const integrationStatusMeta: Record<IntegrationStatus, { label: string; variant: Variant; dot: string; pulse: boolean }> = {
  connected: { label: "Connected", variant: "success", dot: "bg-success", pulse: false },
  disconnected: { label: "Not connected", variant: "muted", dot: "bg-muted-foreground", pulse: false },
  error: { label: "Action needed", variant: "destructive", dot: "bg-destructive", pulse: false },
  syncing: { label: "Syncing", variant: "info", dot: "bg-info", pulse: true },
};
export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  const m = integrationStatusMeta[status];
  return (
    <Badge variant={m.variant}>
      <StatusDot className={m.dot} pulse={m.pulse} />
      {m.label}
    </Badge>
  );
}

// --- Graph node status -------------------------------------------------------
export const graphStatusMeta: Record<GraphNodeStatus, { label: string; variant: Variant; color: string }> = {
  completed: { label: "Completed", variant: "success", color: "hsl(var(--success))" },
  active: { label: "Active", variant: "default", color: "hsl(var(--primary))" },
  pending: { label: "Pending", variant: "muted", color: "hsl(var(--muted-foreground))" },
  blocked: { label: "Blocked", variant: "destructive", color: "hsl(var(--destructive))" },
  skipped: { label: "Skipped", variant: "muted", color: "hsl(var(--muted-foreground))" },
};
export function GraphStatusBadge({ status }: { status: GraphNodeStatus }) {
  const m = graphStatusMeta[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
