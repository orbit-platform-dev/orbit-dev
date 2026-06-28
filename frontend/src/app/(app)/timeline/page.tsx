"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { useProjects, useTimeline } from "@/lib/hooks";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import type { TimelineEvent } from "@/lib/types";
import { TimelineRow, TimelineRowSkeleton } from "@/components/timeline/timeline-row";
import { dayGroup } from "@/components/timeline/timeline-meta";

function isToday(at: string): boolean {
  const d = new Date(at);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function TimelinePage() {
  const { data: events, isLoading } = useTimeline();
  const { data: projects } = useProjects();

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    (projects ?? []).forEach((p) => map.set(p.id, p.name));
    return map;
  }, [projects]);

  const totalEvents = events?.length ?? 0;
  const todayEvents = useMemo(() => (events ?? []).filter((e) => isToday(e.at)).length, [events]);
  const mostRecentId = events && events.length > 0 ? events[0].id : null;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, { label: string; events: TimelineEvent[] }>();
    for (const e of events ?? []) {
      const { key, label } = dayGroup(e.at);
      if (!byKey.has(key)) {
        byKey.set(key, { label, events: [] });
        order.push(key);
      }
      byKey.get(key)!.events.push(e);
    }
    return order.map((k) => ({ key: k, ...byKey.get(k)! }));
  }, [events]);

  return (
    <div>
      <PageHeader
        title="Timeline"
        description="Every meeting, analysis, plan and follow-up your agents execute — in order, as it happens."
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="muted" className="gap-1.5">
            <Activity className="h-3 w-3" />
            <span className="tabular-nums">{totalEvents}</span> events
          </Badge>
          <Badge variant="success" className="gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            <span className="tabular-nums">{todayEvents}</span> today
          </Badge>
        </div>
      </PageHeader>

      {isLoading || !events ? (
        <div className="relative">
          <div className="absolute bottom-2 left-[13px] top-2 w-px bg-border" aria-hidden />
          <ul className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <TimelineRowSkeleton key={i} />
            ))}
          </ul>
        </div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          className="space-y-6"
        >
          {groups.map((group) => (
            <section key={group.key}>
              <motion.h2
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.3 }}
                className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.label}
              </motion.h2>
              <div className="relative">
                <div className="absolute bottom-3 left-[13px] top-1 w-px bg-gradient-to-b from-primary/40 via-border to-transparent" aria-hidden />
                <ul className="space-y-0">
                  {group.events.map((event) => (
                    <TimelineRow
                      key={event.id}
                      event={event}
                      isMostRecent={event.id === mostRecentId}
                      projectName={event.projectId ? projectNameById.get(event.projectId) : undefined}
                    />
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </motion.div>
      )}
    </div>
  );
}
