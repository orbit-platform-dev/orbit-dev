"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity as ActivityIcon, Search } from "lucide-react";
import type { ActivityEvent } from "@/lib/types";
import { useActivity } from "@/lib/hooks";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityRow } from "@/components/activity/activity-row";

type TargetType = ActivityEvent["targetType"];
type ActorMode = "all" | "agents" | "people";

const TARGET_TYPES: TargetType[] = ["meeting", "project", "task", "document", "integration", "agent"];
const TYPE_LABEL: Record<TargetType, string> = {
  meeting: "Signals",
  project: "Projects",
  task: "Tasks",
  document: "Documents",
  integration: "Integrations",
  agent: "Agents",
};

const ACTOR_MODES: { key: ActorMode; label: string }[] = [
  { key: "all", label: "All" },
  { key: "agents", label: "Agents only" },
  { key: "people", label: "People only" },
];

/** Bucket label: Today / Yesterday / explicit date. */
function dayKey(iso: string): { key: string; label: string; order: number } {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = start(new Date());
  const that = start(d);
  const diffDays = Math.round((today - that) / 86400000);
  let label: string;
  if (diffDays <= 0) label = "Today";
  else if (diffDays === 1) label = "Yesterday";
  else label = formatDate(d, { weekday: "long", month: "short", day: "numeric" });
  return { key: String(that), label, order: that };
}

export default function ActivityPage() {
  const { data, isLoading } = useActivity();

  const [types, setTypes] = useState<Set<TargetType>>(new Set());
  const [actorMode, setActorMode] = useState<ActorMode>("all");
  const [query, setQuery] = useState("");

  const toggleType = (t: TargetType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const filtered = useMemo(() => {
    const events = data ?? [];
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => {
        if (types.size > 0 && !types.has(e.targetType)) return false;
        if (actorMode === "agents" && !e.actor.isAgent) return false;
        if (actorMode === "people" && e.actor.isAgent) return false;
        if (!q) return true;
        return (
          e.actor.name.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          e.target.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [data, types, actorMode, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; order: number; events: ActivityEvent[] }>();
    for (const e of filtered) {
      const { key, label, order } = dayKey(e.at);
      const g = map.get(key) ?? { label, order, events: [] };
      g.events.push(e);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.order - a.order);
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="A live feed of everything your team and Orbit are doing across signals, proposals, tasks and integrations."
      />

      {/* Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Actor mode toggle */}
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {ACTOR_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setActorMode(m.key)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  actorMode === m.key
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search activity…"
              className="pl-9"
              aria-label="Search activity"
            />
          </div>
        </div>

        {/* Target-type chips */}
        <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
          {TARGET_TYPES.map((t) => {
            const active = types.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {TYPE_LABEL[t]}
              </button>
            );
          })}
          {types.size > 0 ? (
            <button
              type="button"
              onClick={() => setTypes(new Set())}
              className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Feed */}
      {isLoading ? (
        <ActivitySkeleton />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No activity matches your filters"
          description="Try removing a filter, switching the actor toggle, or clearing your search."
        />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.label + g.order}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
              <motion.ul
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
                className="space-y-0"
              >
                {g.events.map((e, idx) => (
                  <ActivityRow key={e.id} event={e} isLast={idx === g.events.length - 1} />
                ))}
              </motion.ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 2 }).map((_, gi) => (
        <div key={gi}>
          <Skeleton className="mb-3 h-3 w-20" />
          <div className="space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
