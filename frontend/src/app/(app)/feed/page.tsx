"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  GraduationCap,
  Radar,
  RefreshCw,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeed, useLearning, useHeartbeat, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { timeAgo, cn } from "@/lib/utils";
import type { Finding, Brief, Correction, SyncProgress } from "@/lib/types";
import { TimeFilter, withinRange, rangeLabel, type TimeRange } from "@/components/shared/time-filter";

const KIND: Record<string, { label: string; icon: LucideIcon; chip: string }> = {
  gap: { label: "Gap", icon: AlertTriangle, chip: "text-warning bg-warning/10 border-warning/20" },
  drift: { label: "Drift", icon: Radar, chip: "text-primary bg-primary/10 border-primary/20" },
  trend: { label: "Trend", icon: TrendingUp, chip: "text-info bg-info/10 border-info/20" },
  win: { label: "Win", icon: CheckCircle2, chip: "text-success bg-success/10 border-success/20" },
};
const kindMeta = (k: string) => KIND[k] ?? { label: k, icon: Sparkles, chip: "text-muted-foreground bg-muted border-border" };

function KindChip({ kind }: { kind: string }) {
  const m = kindMeta(kind);
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", m.chip)}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

function BriefCard({ brief, range }: { brief: Brief; range: TimeRange }) {
  const cols: [string, string[]][] = [
    ["Risks", brief.evidence?.risks ?? []],
    ["Highlights", brief.evidence?.highlights ?? []],
    ["Recommended", brief.evidence?.recommendations ?? []],
  ];
  return (
    <Card glass className="mb-6 p-6">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3.5 w-3.5" /> {rangeLabel(range)}
      </div>
      <h2 className="text-gradient mt-2 text-[20px] font-semibold tracking-[-0.02em]">{brief.title}</h2>
      {brief.detail ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{brief.detail}</p> : null}
      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        {cols.filter(([, items]) => items.length).map(([label, items]) => (
          <div key={label}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <ul className="mt-1.5 space-y-1 text-sm">
              {items.slice(0, 4).map((t, i) => <li key={i} className="text-foreground/90">{t}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EvidenceChips({ finding }: { finding: Finding }) {
  const chips: string[] = [
    ...finding.entities.slice(0, 3).map((e) => e.name),
    ...finding.artifacts.map((a) => a.externalRef || a.title).slice(0, 2),
  ];
  if (!chips.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{c}</span>
      ))}
    </div>
  );
}

function FindingDrawer({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const qc = useQueryClient();
  const action = finding.action;
  const [title, setTitle] = useState(action?.title ?? "");
  const [description, setDescription] = useState(action?.description ?? "");
  const approved = finding.status === "approved";
  const hasAction = action?.type === "create-linear-issue";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.feed });
    qc.invalidateQueries({ queryKey: qk.entities });
    qc.invalidateQueries({ queryKey: qk.learning });
  };

  const approve = useMutation({
    mutationFn: async () => {
      if (title !== action?.title || description !== action?.description) {
        await api.editFinding(finding.id, { title, description });
      }
      return api.approveFinding(finding.id);
    },
    onSuccess: (f) => { invalidate(); toast.success(`Created ${f.action?.result?.identifier ?? "the Linear issue"}`); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create the issue"),
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismissFinding(finding.id),
    onSuccess: () => { invalidate(); toast.success("Dismissed"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not dismiss"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2"><KindChip kind={finding.kind} /></div>
          <DialogTitle className="pt-1 text-[17px] leading-snug">{finding.title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>

        {(finding.entities.length > 0 || finding.artifacts.length > 0) && (
          <div className="min-w-0 rounded-lg border border-border bg-card/50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</div>
            <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto text-sm">
              {finding.entities.map((e) => (
                <Link
                  key={e.id}
                  href={`/memory/${e.id}`}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/60"
                >
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{e.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                </Link>
              ))}
              {finding.artifacts.map((a) => {
                const inner = (
                  <>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{a.source}</span>
                    <span className="min-w-0 flex-1 truncate" title={a.title}>{a.title}</span>
                    {a.url ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                  </>
                );
                return a.url ? (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/60"
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={a.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hasAction && !approved && (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Recommended action · Create Linear issue</div>
            <div className="space-y-1.5">
              <Label htmlFor="act-title">Title</Label>
              <Input id="act-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-desc">Description</Label>
              <Textarea id="act-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        )}

        {approved && action?.result?.identifier && (
          <div className="rounded-lg border border-success/20 bg-success/[0.06] p-3 text-sm text-success">
            Approved · created{" "}
            {action.result.url ? (
              <a href={action.result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium hover:underline">
                {action.result.identifier} <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : action.result.identifier}
          </div>
        )}

        <DialogFooter>
          {!approved && <Button variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>Dismiss</Button>}
          {hasAction && !approved && (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending || !title.trim()}>
              {approve.isPending ? "Creating…" : "Approve & create"}
            </Button>
          )}
          {(approved || !hasAction) && <Button variant="outline" onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeCorrection(c: Correction): string {
  if (c.field === "dismiss") return `Dismissed "${c.before}"${c.after ? ` (${c.after})` : ""}`;
  return `Refined a recommendation: "${c.before}" → "${c.after}"`;
}

function LearnedCard() {
  const { data } = useLearning();
  if (!data || data.length === 0) return null;
  return (
    <Card className="mt-8 p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <GraduationCap className="h-3.5 w-3.5" /> What Orbit learned
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Your edits and dismissals now shape how Orbit reads calls and drafts recommendations.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {data.slice(0, 6).map((c) => (
          <li key={c.id} className="flex items-baseline gap-2 text-muted-foreground">
            <span className="text-muted-foreground/50">·</span>
            <span className="line-clamp-1">{describeCorrection(c)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ScanningCard({ sync }: { sync?: SyncProgress | null }) {
  const issues = sync?.counts?.issues;
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <RefreshCw className="h-5 w-5 animate-spin text-primary" />
      </div>
      <h3 className="mt-4 text-sm font-medium">Orbit is scanning your workspace</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {sync?.message ?? "Reading your tickets and comparing them to what was promised and decided."}
      </p>
      {issues ? <p className="mt-2 text-xs text-muted-foreground">{issues} tickets read so far</p> : null}
    </div>
  );
}

function FindingCard({ finding, onOpen }: { finding: Finding; onOpen: () => void }) {
  const approved = finding.status === "approved";
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card className="p-5 transition-colors hover:border-primary/30">
        <div className="flex items-center justify-between gap-3">
          <KindChip kind={finding.kind} />
          <span className="text-xs text-muted-foreground">{timeAgo(finding.createdAt)}</span>
        </div>
        <h3 className="mt-3 text-[15px] font-semibold leading-snug tracking-tight">{finding.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{finding.detail}</p>
        <EvidenceChips finding={finding} />
        <div className="mt-4 text-xs font-medium text-primary">
          {approved ? `Approved · ${finding.action?.result?.identifier ?? "synced"}` : finding.action ? "Review & approve →" : "Review →"}
        </div>
      </Card>
    </button>
  );
}

export default function FeedPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useFeed();
  const { data: hb } = useHeartbeat();
  const [range, setRange] = useState<TimeRange>("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const scannedOnce = useRef(false);

  const scan = useMutation({
    mutationFn: api.scanFeed,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.feed });
      qc.invalidateQueries({ queryKey: qk.heartbeat });  // surface the scanning state at once
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const sync = hb?.sync;
  const scanning = !!sync?.active || scan.isPending;

  // On first load with an empty feed, scan once so the page is never dead.
  useEffect(() => {
    if (!isLoading && data && !data.brief && data.findings.length === 0 && !scannedOnce.current) {
      scannedOnce.current = true;
      scan.mutate();
    }
  }, [isLoading, data, scan]);

  // Keep the drawer's finding fresh after mutations.
  const liveSelected = selected && data ? data.findings.find((f) => f.id === selected.id) ?? selected : selected;
  const findings = (data?.findings ?? []).filter((f) => withinRange(f.createdAt, range));

  return (
    <div>
      <PageHeader title="Feed" actions={<TimeFilter value={range} onChange={setRange} />} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : (
        <>
          {findings.length > 0 && data?.brief && (data.brief.detail || data.brief.title) ? <BriefCard brief={data.brief} range={range} /> : null}
          {findings.length === 0 ? (
            scanning ? (
              <ScanningCard sync={sync} />
            ) : (
              <EmptyState
                icon={Sparkles}
                title="Nothing needs attention"
                description="Orbit continuously compares what you promised and decided against what's actually being built. New findings appear here on their own."
                action={<Button variant="outline" onClick={() => scan.mutate()}><RefreshCw className="h-4 w-4" /> Scan now</Button>}
              />
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {findings.map((f) => <FindingCard key={f.id} finding={f} onOpen={() => setSelected(f)} />)}
            </div>
          )}
          <LearnedCard />
        </>
      )}

      {liveSelected && <FindingDrawer finding={liveSelected} onClose={() => setSelected(null)} />}
    </div>
  );
}
