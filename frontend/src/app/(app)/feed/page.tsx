"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  Radar,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { SpecDrawer } from "@/components/shared/spec-drawer";
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
import { findingSources, rankFinding, SEVERITY, sourceKey } from "@/lib/sources";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { SyncTheater } from "@/components/shared/sync-theater";
import type { Finding, Brief, Correction } from "@/lib/types";

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

function BriefCard({ brief, findings }: { brief: Brief; findings: Finding[] }) {
  const cols = [
    { label: "Risks", icon: AlertTriangle, tone: "text-warning", items: brief.evidence?.risks ?? [] },
    { label: "Highlights", icon: CheckCircle2, tone: "text-success", items: brief.evidence?.highlights ?? [] },
    { label: "Recommended", icon: Lightbulb, tone: "text-primary", items: brief.evidence?.recommendations ?? [] },
  ].filter((c) => c.items.length);
  // Honest grounding: the brief summarizes the findings below — show the
  // aggregate evidence per tool, never an arbitrary sample of items.
  const byTool = new Map<string, number>();
  for (const f of findings) for (const a of f.artifacts) {
    const k = sourceKey(a.source);
    if (k) byTool.set(k, (byTool.get(k) ?? 0) + 1);
  }
  return (
    <Card glass className="mb-6 animate-in fade-in-0 slide-in-from-bottom-2 p-6 duration-500">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3.5 w-3.5" /> Company brief
      </div>
      <h2 className="text-gradient mt-2 text-[20px] font-semibold tracking-[-0.02em]">{brief.title}</h2>
      {brief.detail ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{brief.detail}</p> : null}
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        {cols.map(({ label, icon: Icon, tone, items }) => (
          <div key={label}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon className={cn("h-3.5 w-3.5", tone)} /> {label}
            </div>
            <ul className="mt-2.5 space-y-2.5">
              {items.slice(0, 3).map((t, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-snug text-foreground/85">
                  <span className={cn("mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current", tone)} />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {(findings.length > 0 || byTool.size > 0) && (
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span>Grounded in the {findings.length} finding{findings.length === 1 ? "" : "s"} below</span>
          {byTool.size > 0 && <span className="text-muted-foreground/40">·</span>}
          {Array.from(byTool.entries()).map(([tool, n]) => (
            <span key={tool} className="inline-flex items-center gap-1.5">
              <IntegrationLogo k={tool} className="h-4 w-4 rounded-[4px] border-0" />
              <span>{n} item{n === 1 ? "" : "s"}</span>
            </span>
          ))}
        </div>
      )}
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
  const { t } = useTranslation();
  const action = finding.action;
  const [title, setTitle] = useState(action?.title ?? "");
  const [description, setDescription] = useState(action?.description ?? "");
  const [specOpen, setSpecOpen] = useState(false);
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
    <>
    <Dialog open modal={!specOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => { if (specOpen) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (specOpen) e.preventDefault(); }}
      >
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
          <Button variant="ghost" className="mr-auto gap-2" onClick={() => setSpecOpen(true)}>
            <Wand2 className="h-4 w-4" /> {t("spec.generate")}
          </Button>
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
    <SpecDrawer
      open={specOpen}
      onOpenChange={setSpecOpen}
      source={{ title: title || finding.title, description: description || finding.detail, findingId: finding.id }}
    />
    </>
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

function AttentionCard({ finding, onOpen }: { finding: Finding; onOpen: () => void }) {
  const sev = SEVERITY[finding.kind];
  const owner = finding.entities.find((e) => e.kind === "person");
  const sources = findingSources(finding);
  const related = finding.entities.filter((e) => e.kind !== "person").slice(0, 3);
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card className="p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
        <div className="flex flex-wrap items-center gap-2.5">
          <KindChip kind={finding.kind} />
          {sev ? <span className={cn("text-[11px] font-semibold uppercase tracking-wider", sev.cls)}>{sev.label}</span> : null}
          <span className="ml-auto text-xs text-muted-foreground">{timeAgo(finding.createdAt)}</span>
        </div>
        <h3 className="mt-2.5 text-[16px] font-semibold leading-snug tracking-tight">{finding.title}</h3>
        <div className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why Orbit thinks this</div>
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {owner ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium text-foreground">{owner.name}</span> owns this
            </span>
          ) : null}
          {related.map((e) => (
            <span key={e.id} className="rounded-md bg-muted px-2 py-0.5">{e.name}</span>
          ))}
          {sources.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              {sources.map((s) => <IntegrationLogo key={s} k={s} className="h-4 w-4 rounded-[4px]" />)}
              <span>{finding.artifacts.length} evidence item{finding.artifacts.length === 1 ? "" : "s"}</span>
            </span>
          ) : null}
          <span className="ml-auto font-medium text-primary">
            {finding.status === "approved"
              ? `Approved · ${finding.action?.result?.identifier ?? "synced"}`
              : finding.action ? "Review & approve →" : "Review evidence →"}
          </span>
        </div>
      </Card>
    </button>
  );
}

function FindingCard({ finding, onOpen }: { finding: Finding; onOpen: () => void }) {
  const approved = finding.status === "approved";
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card className="p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
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
  const findings = data?.findings ?? [];

  // Rank by importance (kind) + evidence + recency; the top problems get the
  // analyst treatment, the rest stay compact. No flat lists.
  const ranked = [...findings].sort((a, b) => rankFinding(b) - rankFinding(a));
  const attention = ranked.filter((f) => f.kind !== "win" && f.status === "open").slice(0, 3);
  const attentionIds = new Set(attention.map((f) => f.id));
  const rest = ranked.filter((f) => !attentionIds.has(f.id));

  const freshness = hb?.lastRunAt ? `Orbit last looked ${timeAgo(hb.lastRunAt)}` : undefined;

  return (
    <div>
      <PageHeader title="Feed" description={freshness} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : scanning ? (
        // While Orbit reads the tools, the sync IS the page — no half-built data.
        <SyncTheater sync={sync} />
      ) : (
        <>
          {findings.length > 0 && data?.brief && (data.brief.detail || data.brief.title) ? <BriefCard brief={data.brief} findings={findings} /> : null}
          {findings.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing needs attention"
              description="Orbit continuously compares what you promised and decided against what's actually being built. New findings appear here on their own."
              action={<Button variant="outline" onClick={() => scan.mutate()}><RefreshCw className="h-4 w-4" /> Scan now</Button>}
            />
          ) : (
            <>
              {attention.length > 0 && (
                <div className="mb-8">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Needs attention
                  </div>
                  <div className="flex flex-col gap-3">
                    {attention.map((f, i) => (
                      <div key={f.id} className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-500" style={{ animationDelay: `${i * 90}ms` }}>
                        <AttentionCard finding={f} onOpen={() => setSelected(f)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rest.length > 0 && (
                <>
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {attention.length > 0 ? "Also on Orbit's radar" : "Findings"}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {rest.map((f, i) => (
                      <div key={f.id} className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-500" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
                        <FindingCard finding={f} onOpen={() => setSelected(f)} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <LearnedCard />
        </>
      )}

      {liveSelected && <FindingDrawer finding={liveSelected} onClose={() => setSelected(null)} />}
    </div>
  );
}
