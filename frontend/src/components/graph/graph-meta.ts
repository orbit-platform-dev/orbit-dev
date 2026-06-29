import {
  CalendarClock,
  Code2,
  Crosshair,
  FileText,
  HeartHandshake,
  Lightbulb,
  ListChecks,
  PenTool,
  Rocket,
  ShieldCheck,
  Target,
  TrendingUp,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { GraphNodeKind } from "@/lib/types";

export const kindMeta: Record<GraphNodeKind, { label: string; icon: LucideIcon; color: string }> = {
  meeting: { label: "Meeting", icon: Video, color: "#6366f1" },
  "business-goal": { label: "Business Goal", icon: Target, color: "#f43f5e" },
  "feature-request": { label: "Feature Request", icon: Lightbulb, color: "#f59e0b" },
  "customer-intent": { label: "Customer Intent", icon: Crosshair, color: "#f59e0b" },
  prd: { label: "PRD", icon: FileText, color: "#8b5cf6" },
  "execution-plan": { label: "Execution Plan", icon: ListChecks, color: "#6366f1" },
  engineering: { label: "Engineering", icon: Code2, color: "#0ea5e9" },
  design: { label: "Design", icon: PenTool, color: "#ec4899" },
  qa: { label: "QA", icon: ShieldCheck, color: "#10b981" },
  sales: { label: "Sales", icon: TrendingUp, color: "#f59e0b" },
  timeline: { label: "Timeline", icon: CalendarClock, color: "#22d3ee" },
  deployment: { label: "Deployment", icon: Rocket, color: "#22d3ee" },
  "customer-followup": { label: "Customer Follow-up", icon: HeartHandshake, color: "#14b8a6" },
};

// Layout positions keyed by node KIND, so any meeting's generated graph lays out
// the same canonical flow (one node per kind) instead of relying on fixed IDs.
export const kindPositions: Record<GraphNodeKind, { x: number; y: number }> = {
  meeting: { x: 360, y: 0 },
  "business-goal": { x: 40, y: 130 },
  "feature-request": { x: 680, y: 130 },
  "customer-intent": { x: 360, y: 130 },
  prd: { x: 360, y: 260 },
  "execution-plan": { x: 360, y: 390 },
  engineering: { x: 120, y: 540 },
  design: { x: 380, y: 540 },
  sales: { x: 640, y: 540 },
  qa: { x: 250, y: 680 },
  deployment: { x: 600, y: 680 },
  timeline: { x: 360, y: 820 },
  "customer-followup": { x: 360, y: 950 },
};
