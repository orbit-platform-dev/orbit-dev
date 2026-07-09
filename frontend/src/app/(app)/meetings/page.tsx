"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Clock, CloudDownload, Search, Trash2, Upload, Users, Video, Workflow } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Meeting } from "@/lib/types";
import { qk, useMeetings, useMeetStatus, useZoomStatus } from "@/lib/hooks";
import { deleteMeeting } from "@/lib/api";
import { formatDate, formatDuration, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SentimentBadge, UrgencyBadge } from "@/components/shared/status";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sourceMeta } from "@/components/meetings/meeting-source";
import { MeetingUploadDialog } from "@/components/meetings/upload-dialog";
import { UpcomingCalls } from "@/components/meetings/upcoming-calls";
import { ZoomImportDialog } from "@/components/meetings/zoom-import";
import { MeetImportDialog } from "@/components/meetings/meet-import";

function MeetingsInner() {
  const { data: meetings, isLoading } = useMeetings();
  const router = useRouter();
  const params = useSearchParams();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [source, setSource] = React.useState<string>("all");
  const [status, setStatus] = React.useState<string>("all");

  React.useEffect(() => {
    if (params.get("upload")) setUploadOpen(true);
  }, [params]);

  const { data: zoom } = useZoomStatus();
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const { data: meet } = useMeetStatus();
  const [meetOpen, setMeetOpen] = React.useState(false);

  const filtered = (meetings ?? []).filter((m) => {
    const q = query.toLowerCase();
    const matchesQuery = !q || m.title.toLowerCase().includes(q) || m.account.toLowerCase().includes(q);
    const matchesSource = source === "all" || m.source === source;
    const matchesStatus =
      status === "all" || (status === "analyzed" ? m.status === "analyzed" : m.status !== "analyzed");
    return matchesQuery && matchesSource && matchesStatus;
  });

  const analyzed = (meetings ?? []).filter((m) => m.status === "analyzed").length;
  const processing = (meetings ?? []).filter((m) => m.status !== "analyzed").length;

  return (
    <div>
      <PageHeader
        title="Meetings"
        actions={
          <div className="flex items-center gap-2">
            {zoom?.connected && (
              <Button variant="outline" className="gap-2" onClick={() => setZoomOpen(true)}>
                <CloudDownload className="h-4 w-4" /> Import from Zoom
              </Button>
            )}
            {meet?.connected && (
              <Button variant="outline" className="gap-2" onClick={() => setMeetOpen(true)}>
                <Video className="h-4 w-4" /> Import from Meet
              </Button>
            )}
            <Button className="gap-2" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" /> Upload meeting
            </Button>
          </div>
        }
      />

      <UpcomingCalls />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Total meetings" value={String(meetings?.length ?? 0)} hint="across all accounts" />
        <StatCard label="Analyzed" value={String(analyzed)} hint="ready to action" />
        <StatCard label="Processing" value={String(processing)} hint="transcribing / analyzing" />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search meetings or accounts…" className="pl-9" />
        </div>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="zoom">Zoom</SelectItem>
            <SelectItem value="google-meet">Google Meet</SelectItem>
            <SelectItem value="upload">Upload</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="analyzed">Analyzed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Video}
          title="No meetings found"
          description="Try adjusting your filters, or upload a new recording to get started."
          action={
            <Button onClick={() => setUploadOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" /> Upload meeting
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((m, i) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <MeetingRow meeting={m} />
            </motion.div>
          ))}
        </div>
      )}

      <ZoomImportDialog open={zoomOpen} onOpenChange={setZoomOpen} />
      <MeetImportDialog open={meetOpen} onOpenChange={setMeetOpen} />
      <MeetingUploadDialog
        open={uploadOpen}
        onOpenChange={(v) => {
          setUploadOpen(v);
          if (!v && params.get("upload")) router.replace("/meetings");
        }}
      />
    </div>
  );
}

function MeetingRow({ meeting: m }: { meeting: Meeting }) {
  const src = sourceMeta[m.source];
  const SrcIcon = src.icon;
  const processing = m.status !== "analyzed";
  const queryClient = useQueryClient();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const onViewGraph = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/graph?meeting=${m.id}`);
  };

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    try {
      await deleteMeeting(m.id);
      toast.success("Meeting deleted");
      for (const k of [qk.meetings, qk.dashboard, qk.graph, qk.projects, qk.tasks, qk.timeline, qk.activity]) {
        queryClient.invalidateQueries({ queryKey: k });
      }
    } catch (err) {
      toast.error("Delete failed", { description: (err as Error).message });
      throw err;
    }
  };

  return (
    <>
    <ConfirmDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      title="Delete this meeting?"
      description={<>&ldquo;{m.title}&rdquo; and everything derived from it — execution graph, project and tasks — will be permanently removed.</>}
      confirmLabel="Delete meeting"
      destructive
      onConfirm={doDelete}
    />
    <Link
      href={`/meetings/${m.id}`}
      className="glass glass-hover block rounded-xl p-4 transition-all hover:-translate-y-0.5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"
          style={{ background: `${src.color}1a`, borderColor: `${src.color}33`, color: src.color }}
        >
          <SrcIcon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium">{m.title}</h3>
            {m.tags.slice(0, 2).map((t) => (
              <Badge key={t} variant="muted" className="capitalize">{t}</Badge>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{m.account}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(m.durationSec)}</span>
            <span>{formatDate(m.date)} · {timeAgo(m.date)}</span>
            {m.participants.length > 0 && (
              <span className="flex items-center gap-1"><Users className="h-3 w-3" />{m.participants.length}</span>
            )}
          </div>
        </div>

        {/* Participants */}
        {m.participants.length > 0 && (
          <div className="flex -space-x-2">
            {m.participants.slice(0, 3).map((p) => (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <div className="ring-2 ring-card rounded-full">
                    <UserAvatar name={p.name} className="h-7 w-7" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>{p.name} · {p.role}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {/* Status / signals */}
        <div className="flex shrink-0 items-center gap-3 sm:w-56 sm:justify-end">
          {processing ? (
            <div className="w-full sm:w-40">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-info">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
                  {m.status === "transcribing" ? "Transcribing" : "Analyzing"}
                </span>
                <span className="tabular-nums text-muted-foreground">{m.analysisProgress}%</span>
              </div>
              <Progress value={m.analysisProgress} indicatorClassName="bg-info" />
            </div>
          ) : (
            <>
              {m.analysis && (
                <div className="flex items-center gap-1.5">
                  <UrgencyBadge urgency={m.analysis.urgency} />
                  <SentimentBadge sentiment={m.analysis.sentiment.overall} />
                </div>
              )}
            </>
          )}
        </div>

        {m.linkedProjectId && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="View execution graph"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
            onClick={onViewGraph}
          >
            <Workflow className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete meeting"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Link>
    </>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <MeetingsInner />
    </Suspense>
  );
}
