import {
  Upload,
  FileText,
  Sparkles,
  ClipboardList,
  Code2,
  ListChecks,
  CheckCircle2,
  Hammer,
  ShieldCheck,
  Rocket,
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";
import type { TimelineKind } from "@/lib/types";

/**
 * Visual metadata for each timeline event kind: a lucide icon, a hex accent
 * color (used for the node ring + connector glow), and a human label.
 */
export const timelineKindMeta: Record<
  TimelineKind,
  { icon: LucideIcon; color: string; label: string }
> = {
  "meeting-uploaded": { icon: Upload, color: "#6366f1", label: "Meeting uploaded" },
  "transcript-ready": { icon: FileText, color: "#0ea5e9", label: "Transcript ready" },
  "ai-analysis": { icon: Sparkles, color: "#8b5cf6", label: "AI analysis" },
  "prd-generated": { icon: ClipboardList, color: "#a855f7", label: "PRD generated" },
  "engineering-planned": { icon: Code2, color: "#0284c7", label: "Engineering planned" },
  "tasks-created": { icon: ListChecks, color: "#14b8a6", label: "Tasks created" },
  "review-approved": { icon: CheckCircle2, color: "#22c55e", label: "Review approved" },
  "development-started": { icon: Hammer, color: "#f59e0b", label: "Development started" },
  qa: { icon: ShieldCheck, color: "#10b981", label: "QA" },
  deployment: { icon: Rocket, color: "#06b6d4", label: "Deployment" },
  "customer-updated": { icon: HeartHandshake, color: "#f43f5e", label: "Customer updated" },
};

export const timelineKindOrder: TimelineKind[] = [
  "meeting-uploaded",
  "transcript-ready",
  "ai-analysis",
  "prd-generated",
  "engineering-planned",
  "tasks-created",
  "review-approved",
  "development-started",
  "qa",
  "deployment",
  "customer-updated",
];

/** Bucket an ISO date into a relative-day group key + display label. */
export function dayGroup(at: string): { key: string; label: string } {
  const d = new Date(at);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 86_400_000;
  const diffDays = Math.round((startOf(now) - startOf(d)) / dayMs);

  if (diffDays <= 0) return { key: "today", label: "Today" };
  if (diffDays === 1) return { key: "yesterday", label: "Yesterday" };
  if (diffDays < 7) return { key: "earlier-week", label: "Earlier this week" };
  const label = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return { key: `date-${label}`, label };
}
