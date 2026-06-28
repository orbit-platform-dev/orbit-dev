"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, Sparkles, TrendingUp, Video } from "lucide-react";
import type { DashboardData } from "@/lib/api";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import { WidgetCard } from "./widget-card";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

// ---------------------------------------------------------------------------
export function RecentMeetings({ meetings }: { meetings: DashboardData["meetings"] }) {
  return (
    <WidgetCard title="Recent meetings" icon={<Video className="h-4 w-4" />} href="/meetings">
      <div className="space-y-1">
        {meetings.map((m) => (
          <Link
            key={m.id}
            href={`/meetings/${m.id}`}
            className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
              <Video className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.title}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{m.account}</span>
                <span>·</span>
                <span className="shrink-0">{timeAgo(m.date)}</span>
              </div>
            </div>
            {m.status === "analyzed" ? (
              m.analysis && m.analysis.revenueImpact > 0 ? (
                <Badge variant="outline" className="tabular-nums">{formatCurrency(m.analysis.revenueImpact)}</Badge>
              ) : (
                <Badge variant="success">Analyzed</Badge>
              )
            ) : (
              <Badge variant="info">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
                {m.status === "transcribing" ? "Transcribing" : "Analyzing"}
              </Badge>
            )}
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
export function ExecutionProgress({ projects }: { projects: DashboardData["projects"] }) {
  const active = projects.filter((p) => p.status !== "shipped").slice(0, 5);
  return (
    <WidgetCard title="Active projects" icon={<TrendingUp className="h-4 w-4" />} href="/graph">
      <div className="space-y-4">
        {active.map((p) => (
          <Link key={p.id} href="/graph" className="block">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.progress}%</span>
            </div>
            <Progress
              value={p.progress}
              indicatorClassName={cn(
                p.health === "off-track" && "bg-destructive",
                p.health === "at-risk" && "bg-warning",
                p.health === "on-track" && "bg-success",
              )}
            />
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
export function LatestActivity({ activity }: { activity: DashboardData["activity"] }) {
  return (
    <WidgetCard title="What Orbit did" icon={<Sparkles className="h-4 w-4" />} href="/timeline">
      <div className="space-y-1">
        {activity.map((a) => (
          <div key={a.id} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-1.5">
            {a.actor.isAgent ? (
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Bot className="h-3.5 w-3.5" />
              </div>
            ) : (
              <UserAvatar name={a.actor.name} className="mt-0.5 h-7 w-7" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{a.actor.name}</span>{" "}
              <span className="text-muted-foreground">{a.action}</span>{" "}
              <span className="font-medium">{a.target}</span>
              <div className="text-xs text-muted-foreground">{timeAgo(a.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
export function StaggerGrid({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
      className="contents"
    >
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.3 }} className={className}>
      {children}
    </motion.div>
  );
}
