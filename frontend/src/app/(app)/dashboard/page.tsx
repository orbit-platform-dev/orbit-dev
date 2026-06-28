"use client";

import Link from "next/link";
import { Sparkles, Upload } from "lucide-react";
import { useDashboard, useMeetings } from "@/lib/hooks";
import { demoUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ExecutionProgress,
  LatestActivity,
  RecentMeetings,
  Stagger,
  StaggerGrid,
} from "@/components/dashboard/widgets";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const { data: allMeetings } = useMeetings();

  const analyzed = (allMeetings ?? []).filter((m) => m.status === "analyzed").length;
  const processing = (allMeetings ?? []).filter((m) => m.status !== "analyzed").length;
  const activeProjects = (data?.projects ?? []).filter((p) => p.status !== "shipped").length;
  const openFollowUps = (allMeetings ?? []).reduce(
    (n, m) => n + (m.analysis?.actionItems.filter((a) => a.status !== "done").length ?? 0),
    0,
  );
  const stats = [
    { label: "Meetings analyzed", value: String(analyzed), hint: processing ? `${processing} still processing` : "all caught up" },
    { label: "Active projects", value: String(activeProjects), hint: "in flight" },
    { label: "Open follow-ups", value: String(openFollowUps), hint: "across recent calls" },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${demoUser.name.split(" ")[0]}`}
        description={`${formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" })} · Here's what your agents have been up to.`}
        actions={
          <>
            <Button asChild variant="outline" className="gap-2 text-muted-foreground">
              <Link href="/chat">
                <Sparkles className="h-4 w-4" /> Ask Orbit
                <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
                  Soon
                </Badge>
              </Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href="/meetings?upload=1">
                <Upload className="h-4 w-4" /> Upload meeting
              </Link>
            </Button>
          </>
        }
      />

      {/* Three focused KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {isLoading || !data
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
          : stats.map((t) => <StatCard key={t.label} label={t.label} value={t.value} hint={t.hint} />)}
      </div>

      {isLoading || !data ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Skeleton className="h-80 lg:col-span-7" />
          <Skeleton className="h-80 lg:col-span-5" />
          <Skeleton className="h-56 lg:col-span-12" />
        </div>
      ) : (
        <StaggerGrid>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Stagger className="lg:col-span-7">
              <RecentMeetings meetings={data.meetings} />
            </Stagger>
            <Stagger className="lg:col-span-5">
              <LatestActivity activity={data.activity} />
            </Stagger>
            <Stagger className="lg:col-span-12">
              <ExecutionProgress projects={data.projects} />
            </Stagger>
          </div>
        </StaggerGrid>
      )}
    </div>
  );
}
