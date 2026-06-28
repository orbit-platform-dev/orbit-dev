"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Video, FolderKanban } from "lucide-react";
import type { TimelineEvent } from "@/lib/types";
import { cn, formatDate, formatTime, timeAgo } from "@/lib/utils";
import { AgentIcon } from "@/components/shared/agent-icon";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timelineKindMeta } from "./timeline-meta";

export function TimelineRow({
  event,
  isMostRecent = false,
  projectName,
}: {
  event: TimelineEvent;
  isMostRecent?: boolean;
  projectName?: string;
}) {
  const meta = timelineKindMeta[event.kind];
  const Icon = meta.icon;
  const metaEntries = Object.entries(event.meta ?? {});

  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="relative flex gap-4 pl-0.5"
    >
      {/* Node */}
      <div className="relative z-10 flex flex-col items-center">
        {event.agent ? (
          <AgentIcon agent={event.agent} size="sm" className="ring-2 ring-background" />
        ) : (
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ring-2 ring-background"
            style={{ background: `${meta.color}1a`, borderColor: `${meta.color}40`, color: meta.color }}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        {/* Active pulse on the most recent event */}
        {isMostRecent ? (
          <span className="pointer-events-none absolute -inset-1 -z-10 rounded-xl">
            <span
              className="absolute inset-0 animate-ping rounded-xl opacity-40"
              style={{ background: `${meta.color}55` }}
            />
          </span>
        ) : null}
      </div>

      {/* Card */}
      <Card className="mb-3 flex-1 border-border/80 bg-card/60 p-4 transition-colors hover:border-border hover:bg-card">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium leading-snug">{event.title}</h3>
              <Badge
                variant="muted"
                className="shrink-0"
                style={{ color: meta.color, background: `${meta.color}14` }}
              >
                {meta.label}
              </Badge>
              {isMostRecent ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                  Live
                </span>
              ) : null}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 cursor-default text-xs tabular-nums text-muted-foreground">
                {timeAgo(event.at)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {formatDate(event.at, { month: "short", day: "numeric", year: "numeric" })} · {formatTime(event.at)}
            </TooltipContent>
          </Tooltip>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>

        {/* Meta chips */}
        {metaEntries.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {metaEntries.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                <span>{k}</span>
                <span className="font-medium tabular-nums text-foreground">{v}</span>
              </span>
            ))}
          </div>
        ) : null}

        {/* Footer: actor + links */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            by <span className="font-medium text-foreground">{event.actor}</span>
          </span>
          {event.projectId ? (
            <Link
              href={event.meetingId ? `/meetings/${event.meetingId}` : "/graph"}
              className="group inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
            >
              <FolderKanban className="h-3 w-3" />
              <span className="max-w-[12rem] truncate">{projectName ?? "View project"}</span>
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ) : null}
          {event.meetingId ? (
            <Link
              href={`/meetings/${event.meetingId}`}
              className="group inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
            >
              <Video className="h-3 w-3" />
              <span>View meeting</span>
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ) : null}
        </div>
      </Card>
    </motion.li>
  );
}

export function TimelineRowSkeleton() {
  return (
    <li className="relative flex gap-4 pl-0.5">
      <div className="h-7 w-7 shrink-0 rounded-lg bg-muted/60" />
      <div className="mb-3 flex-1 rounded-xl border border-border bg-card/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-1/2 rounded bg-muted/60" />
          <div className="h-3 w-12 rounded bg-muted/60" />
        </div>
        <div className="mt-2 h-3 w-3/4 rounded bg-muted/50" />
        <div className="mt-3 flex gap-1.5">
          <div className="h-4 w-16 rounded bg-muted/40" />
          <div className="h-4 w-16 rounded bg-muted/40" />
        </div>
      </div>
    </li>
  );
}
