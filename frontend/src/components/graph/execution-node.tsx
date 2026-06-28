"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ExecutionNode as ExecutionNodeData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { graphStatusMeta } from "@/components/shared/status";
import { AgentIcon } from "@/components/shared/agent-icon";
import { kindMeta } from "./graph-meta";

export type FlowNodeData = ExecutionNodeData & { dimmed?: boolean };

const statusRing: Record<ExecutionNodeData["status"], string> = {
  completed: "border-success/40",
  active: "border-primary/70",
  pending: "border-border border-dashed",
  blocked: "border-destructive/60",
  skipped: "border-muted-foreground/20 border-dashed",
};

export function ExecutionFlowNode({ data, selected }: NodeProps) {
  const node = data as unknown as FlowNodeData;
  const meta = kindMeta[node.kind];
  const Icon = meta.icon;
  const statusColor = graphStatusMeta[node.status].color;

  return (
    <div
      className={cn(
        "group relative w-[240px] rounded-xl border bg-card/95 p-3 backdrop-blur transition-all duration-300",
        statusRing[node.status],
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "shadow-card",
        node.dimmed && "opacity-25 saturate-50",
        node.status === "skipped" && "opacity-60 saturate-50",
        node.status === "active" && "shadow-glow-sm",
      )}
    >
      <Handle type="target" position={Position.Top} className="!border-border !bg-muted-foreground" />

      {/* Active pulse ring */}
      {node.status === "active" && (
        <span className="pointer-events-none absolute -inset-px rounded-xl border border-primary/40 animate-pulse-ring" />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md border"
            style={{ background: `${meta.color}1f`, borderColor: `${meta.color}40`, color: meta.color }}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</span>
        </div>
        <span className="relative flex h-2 w-2">
          {node.status === "active" && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: statusColor }} />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: statusColor }} />
        </span>
      </div>

      <div className="mt-2 text-sm font-medium leading-tight">{node.title}</div>
      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{node.subtitle}</div>

      {(node.status === "active" || (node.progress > 0 && node.status !== "completed")) && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Progress</span>
            <span className="tabular-nums">{node.progress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${node.progress}%`, background: statusColor }} />
          </div>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2">
        <div className="flex items-center gap-1.5">
          {node.agent ? <AgentIcon agent={node.agent} size="sm" className="!h-5 !w-5 rounded" /> : null}
          <span className="text-[11px] text-muted-foreground">{node.owner ?? "Unassigned"}</span>
        </div>
        <span className="text-[10px] font-medium" style={{ color: statusColor }}>
          {graphStatusMeta[node.status].label}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!border-border !bg-muted-foreground" />
    </div>
  );
}
