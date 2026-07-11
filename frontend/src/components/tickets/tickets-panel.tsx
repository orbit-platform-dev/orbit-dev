"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, ExternalLink, Plus, Sparkles, Zap } from "lucide-react";
import type { Task } from "@/lib/types";
import { useIntegrations, useTasks } from "@/lib/hooks";
import { useTicketPrefs } from "@/lib/ticket-prefs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { integrationBrand } from "@/components/shared/integration-logo";

const SYNCED_COLUMNS = new Set(["done", "in-progress", "review"]);
const columnLabel: Record<string, string> = {
  done: "Done",
  "in-progress": "In Progress",
  review: "In Review",
  todo: "Todo",
  backlog: "Backlog",
};
const priorityDot: Record<string, string> = {
  urgent: "bg-destructive",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground",
};

export function TicketsPanel({
  scope,
  compact = false,
}: {
  scope: { projectId?: string };
  compact?: boolean;
}) {
  const { data: tasks, isLoading } = useTasks();
  const { data: integrations } = useIntegrations();
  const { prefs, setPrefs } = useTicketPrefs();
  const [createdNow, setCreatedNow] = React.useState<Set<string>>(new Set());

  const brand = integrationBrand[prefs.provider];
  const providerName = prefs.provider === "linear" ? "Linear" : "Jira";
  const integration = integrations?.find((i) => i.key === prefs.provider);
  const connected = integration ? integration.status === "connected" || integration.status === "syncing" : false;

  const tickets = (tasks ?? []).filter((t) =>
    scope.projectId ? t.projectId === scope.projectId : false,
  );

  const state = (t: Task): "synced" | "auto" | "suggested" => {
    if (SYNCED_COLUMNS.has(t.column) || createdNow.has(t.id)) return "synced";
    if (prefs.autoCreate && connected) return "auto";
    return "suggested";
  };

  const externalKey = (t: Task) => (prefs.provider === "linear" ? t.key.replace(/^[A-Z]+/, "LIN") : t.key);
  const suggestions = tickets.filter((t) => state(t) === "suggested");

  const createOne = (t: Task) => {
    setCreatedNow((s) => new Set(s).add(t.id));
    toast.success(`Created ${externalKey(t)} in ${providerName}`, { description: t.title });
  };
  const createAll = () => {
    setCreatedNow((s) => {
      const next = new Set(s);
      suggestions.forEach((t) => next.add(t.id));
      return next;
    });
    toast.success(`Created ${suggestions.length} tickets in ${providerName}`);
  };

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  if (tickets.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">No tickets for this stage yet — they appear once the Engineering Planner breaks down the work.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Provider + mode bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/40 p-2.5">
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-semibold"
            style={{ background: `${brand.color}1f`, color: brand.color }}
          >
            {brand.short}
          </div>
          <span className="text-sm font-medium">{providerName}</span>
          {connected ? (
            <Badge variant="success" className="gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" />Connected</Badge>
          ) : (
            <Badge variant="muted">Not connected</Badge>
          )}
        </div>
        {connected ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Zap className={cn("h-3.5 w-3.5", prefs.autoCreate && "text-primary")} />
            Auto-create
            <Switch checked={prefs.autoCreate} onCheckedChange={(v) => setPrefs({ autoCreate: v })} />
          </label>
        ) : (
          <Button asChild size="sm" variant="outline" className="h-7 gap-1.5">
            <Link href="/integrations">Connect {providerName}</Link>
          </Button>
        )}
      </div>

      {connected && (
        <p className="px-0.5 text-xs text-muted-foreground">
          {prefs.autoCreate
            ? `The Engineering Planner pushes tickets to ${providerName} automatically as work is broken down.`
            : `The agent suggests tickets from this stage — review and create them in ${providerName} with one click.`}
        </p>
      )}

      {/* Suggested → create-all */}
      {connected && !prefs.autoCreate && suggestions.length > 0 && (
        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={createAll}>
          <Plus className="h-3.5 w-3.5" /> Create {suggestions.length} suggested {suggestions.length === 1 ? "ticket" : "tickets"} in {providerName}
        </Button>
      )}

      {/* Tickets */}
      <div className="space-y-1.5">
        {tickets.map((t) => {
          const s = state(t);
          return (
            <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card/60 p-2.5">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDot[t.priority])} title={`${t.priority} priority`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-muted-foreground">{s === "suggested" ? t.key : externalKey(t)}</span>
                  {s === "synced" && <Badge variant={t.column === "done" ? "success" : t.column === "review" ? "warning" : "info"} className="px-1.5 py-0">{columnLabel[t.column]}</Badge>}
                  {s === "auto" && <Badge variant="default" className="gap-0.5 px-1.5 py-0"><Sparkles className="h-2.5 w-2.5" />Auto-created</Badge>}
                  {s === "suggested" && <Badge variant="muted" className="px-1.5 py-0">Suggested</Badge>}
                </div>
                <div className={cn("truncate text-sm", compact && "text-[13px]")}>{t.title}</div>
              </div>
              {s === "suggested" ? (
                <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-xs" disabled={!connected} onClick={() => createOne(t)}>
                  <Plus className="h-3 w-3" /> Create
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => toast.message(`Opening ${externalKey(t)} in ${providerName}…`)}
                  title={`Open in ${providerName}`}
                >
                  {s === "synced" && t.column === "done" ? <Check className="h-4 w-4 text-success" /> : <ExternalLink className="h-4 w-4" />}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
