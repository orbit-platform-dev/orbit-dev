import {
  AudioLines,
  ClipboardList,
  Code2,
  PenTool,
  ShieldCheck,
  TrendingUp,
  HeartHandshake,
  Compass,
  type LucideIcon,
} from "lucide-react";
import type { AgentKey } from "@/lib/types";
import { cn } from "@/lib/utils";

export const agentMeta: Record<AgentKey, { icon: LucideIcon; color: string }> = {
  "meeting-intelligence": { icon: AudioLines, color: "#6366f1" },
  "product-manager": { icon: ClipboardList, color: "#8b5cf6" },
  "engineering-planner": { icon: Code2, color: "#0ea5e9" },
  "design-planner": { icon: PenTool, color: "#ec4899" },
  "qa-planner": { icon: ShieldCheck, color: "#10b981" },
  "sales-planner": { icon: TrendingUp, color: "#f59e0b" },
  "customer-success": { icon: HeartHandshake, color: "#14b8a6" },
  "leadership-advisor": { icon: Compass, color: "#f43f5e" },
};

export function AgentIcon({
  agent,
  className,
  size = "default",
}: {
  agent: AgentKey;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const meta = agentMeta[agent];
  const Icon = meta.icon;
  const sizes = { sm: "h-7 w-7", default: "h-9 w-9", lg: "h-11 w-11" };
  const iconSizes = { sm: "h-3.5 w-3.5", default: "h-4 w-4", lg: "h-5 w-5" };
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-lg border", sizes[size], className)}
      style={{ background: `${meta.color}1a`, borderColor: `${meta.color}33`, color: meta.color }}
    >
      <Icon className={iconSizes[size]} />
    </div>
  );
}
