import {
  Code2,
  FileText,
  HeartHandshake,
  Lightbulb,
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
  prd: { label: "PRD", icon: FileText, color: "#8b5cf6" },
  engineering: { label: "Engineering", icon: Code2, color: "#0ea5e9" },
  design: { label: "Design", icon: PenTool, color: "#ec4899" },
  qa: { label: "QA", icon: ShieldCheck, color: "#10b981" },
  sales: { label: "Sales", icon: TrendingUp, color: "#f59e0b" },
  deployment: { label: "Deployment", icon: Rocket, color: "#22d3ee" },
  "customer-followup": { label: "Customer Follow-up", icon: HeartHandshake, color: "#14b8a6" },
};

// Layout positions keyed by node KIND, so any meeting's generated graph lays out
// the same canonical flow (one node per kind) instead of relying on fixed IDs.
export const kindPositions: Record<GraphNodeKind, { x: number; y: number }> = {
  meeting: { x: 360, y: 0 },
  "business-goal": { x: 120, y: 150 },
  "feature-request": { x: 360, y: 150 },
  prd: { x: 360, y: 300 },
  engineering: { x: 140, y: 460 },
  design: { x: 580, y: 460 },
  sales: { x: 140, y: 610 },
  qa: { x: 400, y: 610 },
  deployment: { x: 600, y: 610 },
  "customer-followup": { x: 360, y: 770 },
};
