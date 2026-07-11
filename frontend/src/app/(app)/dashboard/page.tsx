"use client";

// Company Intelligence — the AI-OS surface. Shows what Orbit understands right
// now: the latest brief, detected risks/gaps/trends (deterministic, evidence-
// backed), and the freshest signals. Detection and briefs run on demand — no
// silent background magic.

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, Building2, CheckCircle2, FileText, GitBranch, Lightbulb,
  Plus, Radar, ScrollText, Target, Trash2, Trophy, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useCustomers, useDashboard, useGoals, useHeartbeat, useInsights, useMeetings, useProjects } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { Goal, Insight } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LatestActivity, RecentMeetings, Stagger, StaggerGrid } from "@/components/dashboard/widgets";
import { MeetingUploadDialog } from "@/components/meetings/upload-dialog";

const KIND_META: Record<Exclude<Insight["kind"], "brief">, { label: string; icon: React.ElementType; color: string }> = {
  risk: { label: "Risk", icon: AlertTriangle, color: "#ef4444" },
  gap: { label: "Gap", icon: GitBranch, color: "#f59e0b" },
  trend: { label: "Trend", icon: Lightbulb, color: "#0ea5e9" },
  win: { label: "Delivered", icon: Trophy, color: "#10b981" },
};

export default function DashboardPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useDashboard();
  const { data: allMeetings } = useMeetings();
  const { data: projects } = useProjects();
  const { data: customers } = useCustomers();
  const { data: insights } = useInsights();
  const { data: heartbeat } = useHeartbeat();
  const [scanning, setScanning] = React.useState(false);
  const [briefing, setBriefing] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  // ?upload=1 (sidebar CTA / command menu) opens the Add-signal dialog directly.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upload")) {
      setUploadOpen(true);
      window.history.replaceState(null, "", "/dashboard");
    }
  }, []);

  const openInsights = (insights ?? []).filter((i) => i.status === "open" && i.kind !== "brief");
  const latestBrief = (insights ?? []).find((i) => i.kind === "brief");
  const draftProposals = (projects ?? []).filter((p) => p.approvalStatus !== "approved").length;
  const openCommitments = (customers ?? []).reduce((n, c) => n + c.openCommitments, 0);

  const scan = async () => {
    setScanning(true);
    try {
      const found = await api.scanInsights();
      qc.invalidateQueries({ queryKey: qk.insights });
      toast.success(found.length ? `${found.length} new insight(s) detected` : "No new gaps found — all clear");
    } catch (err) { toast.error("Scan failed", { description: (err as Error).message }); }
    finally { setScanning(false); }
  };

  const brief = async () => {
    setBriefing(true);
    try {
      await api.generateBrief();
      qc.invalidateQueries({ queryKey: qk.insights });
      toast.success("Company brief generated");
    } catch (err) { toast.error("Couldn't generate the brief", { description: (err as Error).message }); }
    finally { setBriefing(false); }
  };

  return (
    <div>
      <PageHeader
        title="Company intelligence"
        description="What Orbit understands about your company right now — signals, risks, and gaps between intention and reality."
        actions={
          <>
            <Button variant="outline" className="gap-2" onClick={scan} disabled={scanning}>
              <Radar className="h-4 w-4" /> {scanning ? "Scanning…" : "Scan for gaps"}
            </Button>
            <Button variant="outline" className="gap-2" onClick={brief} disabled={briefing}>
              <ScrollText className="h-4 w-4" /> {briefing ? "Writing…" : "Generate brief"}
            </Button>
       
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Signals" value={String(allMeetings?.length ?? 0)} hint="conversations & documents" />
        <StatCard label="Open insights" value={String(openInsights.length)} hint="risks, gaps, trends" />
        <StatCard label="Open commitments" value={String(openCommitments)} hint="promises not yet delivered" />
        <StatCard label="Proposals awaiting review" value={String(draftProposals)} hint="drafted, not decided" />
      </div>

      {/* ── The brief ── */}
      {latestBrief && (
        <Card className="mt-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
              <ScrollText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight">{latestBrief.title}</h2>
                <span className="text-[11px] text-muted-foreground">{timeAgo(latestBrief.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{latestBrief.detail}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {(["risks", "highlights", "recommendations"] as const).map((section) => {
                  const items = (latestBrief.evidence[section] as string[] | undefined) ?? [];
                  if (!items.length) return null;
                  return (
                    <div key={section}>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{section}</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {items.slice(0, 4).map((it, i) => <li key={i}>{it}</li>)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Detected insights ── */}
      <Card className="mt-4 p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
            <Radar className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold tracking-tight">Needs attention</h2>
            <p className="text-xs text-muted-foreground">Every insight is evidence-backed — nothing here is invented.</p>
          </div>
          {heartbeat?.enabled && (
            <span className="text-[11px] text-muted-foreground">
              Auto-scan every {heartbeat.intervalMinutes}m
              {heartbeat.lastRunAt ? <> · last scan {timeAgo(heartbeat.lastRunAt)}</> : <> · first scan pending</>}
            </span>
          )}
        </div>
        {openInsights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing open. Orbit keeps scanning on its own — new gaps and risks appear here without being asked for.
          </p>
        ) : (
          <div className="space-y-2">
            {openInsights.map((ins) => <InsightRow key={ins.id} insight={ins} />)}
          </div>
        )}
      </Card>

      <GoalsCard />

      <MeetingUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      {isLoading || !data ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Skeleton className="h-80 lg:col-span-7" />
          <Skeleton className="h-80 lg:col-span-5" />
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
          </div>
        </StaggerGrid>
      )}
    </div>
  );
}

function InsightRow({ insight: ins }: { insight: Insight }) {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const meta = KIND_META[ins.kind as keyof typeof KIND_META] ?? KIND_META.gap;
  const Icon = meta.icon;

  const setStatus = async (status: Insight["status"]) => {
    setBusy(true);
    try {
      await api.patchInsight(ins.id, status);
      qc.invalidateQueries({ queryKey: qk.insights });
    } catch (err) { toast.error("Couldn't update", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
        style={{ background: `${meta.color}1a`, borderColor: `${meta.color}33`, color: meta.color }}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{ins.title}</span>
          <Badge variant="muted" className="text-[10px]" style={{ color: meta.color }}>{meta.label}</Badge>
          {ins.customerId && (
            <Link href={`/customers/${ins.customerId}`}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
              <Building2 className="h-3 w-3" /> customer
            </Link>
          )}
        </div>
        {ins.detail && <p className="mt-0.5 text-xs text-muted-foreground">{ins.detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" disabled={busy}
          onClick={() => setStatus("acknowledged")}>
          <FileText className="h-3 w-3" /> Later
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground hover:text-success" disabled={busy}
          onClick={() => setStatus("resolved")}>
          <CheckCircle2 className="h-3 w-3" /> Resolved
        </Button>
      </div>
    </div>
  );
}

function GoalsCard() {
  const qc = useQueryClient();
  const { data: goals } = useGoals();
  const [title, setTitle] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Goal | null>(null);
  const open = (goals ?? []).filter((g) => g.status === "open");
  const done = (goals ?? []).filter((g) => g.status !== "open");

  const refresh = () => qc.invalidateQueries({ queryKey: qk.goals });

  const addGoal = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api.createGoal({ title: title.trim(), targetDate: target ? new Date(target).toISOString() : null });
      setTitle(""); setTarget("");
      refresh();
    } catch (err) { toast.error("Couldn't add the goal", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  const setStatus = async (g: Goal, status: Goal["status"]) => {
    try { await api.patchGoal(g.id, { status }); refresh(); }
    catch (err) { toast.error("Couldn't update", { description: (err as Error).message }); }
  };

  return (
    <Card className="mt-4 p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
          <Target className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Company goals</h2>
          <p className="text-xs text-muted-foreground">Declared intentions — Orbit measures signals and tracked work against these.</p>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addGoal(); }}
          placeholder='e.g. "Ship SSO for enterprise accounts"' className="flex-1" />
        <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)}
          className="sm:w-40" aria-label="Target date (optional)" />
        <Button className="gap-1.5" disabled={!title.trim() || busy} onClick={addGoal}>
          <Plus className="h-4 w-4" /> Add goal
        </Button>
      </div>

      {open.length === 0 && done.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No goals yet. Without declared intentions, Orbit can only compare reality against promises captured from signals.
        </p>
      ) : (
        <div className="space-y-1.5">
          {open.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.title}</span>
                {g.targetDate && (
                  <span className="text-[11px] text-muted-foreground">target {g.targetDate.slice(0, 10)}</span>
                )}
              </span>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground hover:text-success"
                onClick={() => setStatus(g, "achieved")}>
                <CheckCircle2 className="h-3 w-3" /> Achieved
              </Button>
              <Trash2 className="h-3.5 w-3.5 shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => setDeleteTarget(g)} />
            </div>
          ))}
          {done.length > 0 && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              {done.length} goal(s) achieved or dropped.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete this goal?"
        description={<>&ldquo;{deleteTarget?.title}&rdquo; will be removed; related insights stay until resolved.</>}
        confirmLabel="Delete goal"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api.deleteGoal(deleteTarget.id);
          refresh();
        }}
      />
    </Card>
  );
}
