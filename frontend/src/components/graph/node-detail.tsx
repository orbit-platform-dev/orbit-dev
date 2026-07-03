"use client";

import { motion } from "framer-motion";
import { History, X } from "lucide-react";
import type { ExecutionNode, GraphNodeKind } from "@/lib/types";
import { cn, formatDate, formatTime, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { GraphStatusBadge } from "@/components/shared/status";
import { AgentIcon } from "@/components/shared/agent-icon";
import { agentMeta } from "@/components/shared/agent-icon";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useConnectedProvider, useProject, useTasks } from "@/lib/hooks";
import * as api from "@/lib/api";
import { WorkItemCard } from "@/components/execution/work-item-card";
import { kindMeta } from "./graph-meta";

// Node kinds that carry work items, and how to scope tasks to each.
const WORK_KINDS = new Set<string>(["execution-plan", "engineering", "design", "qa", "sales", "customer-followup"]);
const NODE_DISCIPLINE: Record<string, string> = {
  engineering: "engineering", design: "design", qa: "qa", sales: "sales", "customer-followup": "customer-success",
};

// Sharp, plain-language statement of what each stage/team is responsible for.
const kindPurpose: Partial<Record<GraphNodeKind, string>> = {
  meeting: "The customer conversation this all started from.",
  "business-goal": "The business outcome to drive.",
  "feature-request": "The core need extracted from the call.",
  "customer-intent": "What the customer actually needs — requests, bugs, goals and deadlines.",
  prd: "What to build — problem, goals, and prioritized user stories.",
  "execution-plan": "The cross-functional work items needed to deliver the PRD.",
  timeline: "Estimated delivery, milestones and the critical path.",
  engineering: "How to build it — architecture, components, estimate and risks.",
  design: "The user flows and screens to design.",
  qa: "Test strategy and coverage to ship it safely.",
  sales: "Positioning and talk tracks to take it to market.",
  deployment: "Rollout to customers.",
  "customer-followup": "Closing the loop with the customer.",
};

export function NodeDetail({ node, onClose }: { node: ExecutionNode; onClose: () => void }) {
  const meta = kindMeta[node.kind];
  const Icon = meta.icon;
  const isSkipped = node.status === "skipped" || Boolean(node.meta.skipped);
  const reason = node.meta.reason ? String(node.meta.reason) : "";

  const qc = useQueryClient();
  const { data: allTasks } = useTasks();
  const { data: project } = useProject(node.projectId ?? "");
  const connectedProvider = useConnectedProvider();
  const members = api.directory.members;
  const canPush = project?.approvalStatus === "approved";
  const nodeTasks = (allTasks ?? []).filter(
    (t) => t.projectId === node.projectId && (node.kind === "execution-plan" || t.discipline === NODE_DISCIPLINE[node.kind]),
  );
  const invalidateNode = () => {
    qc.invalidateQueries({ queryKey: qk.tasks });
    if (node.projectId) qc.invalidateQueries({ queryKey: qk.project(node.projectId) });
  };

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-80 flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-2 p-4">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg border"
            style={{ background: `${meta.color}1f`, borderColor: `${meta.color}40`, color: meta.color }}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{meta.label}</div>
            <GraphStatusBadge status={node.status} />
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="no-scrollbar overflow-y-auto px-4 pb-4">
        <h3 className="text-base font-semibold leading-tight">{node.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{node.subtitle}</p>

        {reason && (
          <div
            className={cn(
              "mt-3 rounded-lg border p-2.5",
              isSkipped ? "border-muted-foreground/20 bg-muted/30" : "border-primary/30 bg-primary/5",
            )}
          >
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/70">
              {isSkipped ? "Why Orbit skipped this" : "Why this is here"}
            </div>
            <p className="text-xs text-muted-foreground">{reason}</p>
          </div>
        )}

        {kindPurpose[node.kind] && (
          <div className="mt-3 rounded-lg border border-border bg-background/40 p-2.5">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">What this stage does</div>
            <p className="text-xs text-muted-foreground">{kindPurpose[node.kind]}</p>
          </div>
        )}

        {node.progress > 0 && node.status !== "completed" && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="tabular-nums">{node.progress}%</span>
            </div>
            <Progress value={node.progress} indicatorClassName={node.status === "blocked" ? "bg-destructive" : undefined} />
          </div>
        )}

        {node.agent && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5">
            <AgentIcon agent={node.agent} size="sm" />
            <div className="min-w-0">
              <div className="text-xs font-medium" style={{ color: agentMeta[node.agent]?.color }}>
                Owned by agent
              </div>
              <div className="truncate text-xs capitalize text-muted-foreground">{node.agent.replace(/-/g, " ")}</div>
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="mt-4 space-y-2">
          {Object.entries(node.meta)
            .filter(([k]) => k !== "reason" && k !== "skipped")
            .map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium tabular-nums">{String(v)}</span>
              </div>
            ))}
        </div>

        {WORK_KINDS.has(node.kind) && !isSkipped && nodeTasks.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Work items · {nodeTasks.length}</span>
              {!canPush && <span className="text-[10px] text-muted-foreground">Approve the plan to push</span>}
            </div>
            <div className="space-y-2">
              {nodeTasks.map((t) => (
                <WorkItemCard
                  key={t.id}
                  task={t}
                  members={members}
                  connectedProvider={connectedProvider}
                  canPush={canPush}
                  canEdit={!canPush}
                  onChanged={invalidateNode}
                  compact
                />
              ))}
            </div>
          </>
        )}

        <Separator className="my-4" />

        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <History className="h-3.5 w-3.5" /> Node history
        </div>
        <ol className="relative space-y-3 border-l border-border pl-4">
          {node.history.map((h, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full border-2 border-card bg-primary" />
              <div className="text-sm">{h.event}</div>
              <div className="text-xs text-muted-foreground">
                {h.actor} · <span title={`${formatDate(h.at)} ${formatTime(h.at)}`}>{timeAgo(h.at)}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </motion.aside>
  );
}
