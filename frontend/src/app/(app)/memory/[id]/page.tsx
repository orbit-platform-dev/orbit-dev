"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Brain, Database, FileText, History, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { useEntity } from "@/lib/hooks";
import { cn, timeAgo } from "@/lib/utils";
import { entityMeta, LINK_LABEL, CommitmentStatusChip } from "@/components/memory/entity-meta";
import type { Artifact, IntegrationKey, MemoryFact } from "@/lib/types";

// Work grouped per connector — the brain view, not an activity log.
const SOURCE_GROUPS: { label: string; logo: IntegrationKey | null; match: (s: string) => boolean }[] = [
  { label: "Linear issues", logo: "linear", match: (s) => s.startsWith("linear") },
  { label: "GitHub activity", logo: "github", match: (s) => s.startsWith("github") },
  { label: "Slack discussions", logo: "slack", match: (s) => s.startsWith("slack") },
  { label: "Calls & documents", logo: null, match: () => true },
];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confidence ${pct}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", pct >= 80 ? "bg-emerald-500" : pct >= 55 ? "bg-amber-500" : "bg-red-400")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
    </span>
  );
}

function FactRow({ f }: { f: MemoryFact }) {
  const superseded = f.status !== "active";
  return (
    <div className={cn("flex items-start gap-3 px-2 py-2", superseded && "opacity-60")}>
      {superseded ? (
        <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm leading-snug", superseded && "line-through decoration-border")}>{f.fact}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-px font-medium uppercase tracking-wide">{f.kind}</span>
          {f.sourceRef ? <span>{f.sourceRef}</span> : null}
          {superseded ? <span className="italic">historical</span> : null}
        </div>
      </div>
      <ConfidenceBar value={f.confidence} />
    </div>
  );
}

function WorkRow({ type, artifact }: { type: string; artifact: Artifact }) {
  const state = (artifact as Artifact & { meta?: Record<string, unknown> }).extracted?.status || "";
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">{LINK_LABEL[type] ?? type}</span>
          <span>· {timeAgo(artifact.occurredAt)}</span>
          {state ? <span className="truncate">· {state}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">{artifact.title}</div>
      </div>
      {artifact.url ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const cls = "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-accent/50";
  return artifact.url ? (
    <a href={artifact.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function EntityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useEntity(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (!data) {
    return <EmptyState icon={Database} title="Entity not found" description="It may have been removed, or memory hasn't resolved it yet." />;
  }

  const { entity, artifacts, relatedEntities, facts } = data;
  const { label, icon: Icon } = entityMeta(entity.kind);

  // Partition linked work into per-connector groups (each artifact lands once).
  const remaining = [...artifacts];
  const groups = SOURCE_GROUPS.map((g) => {
    const mine: typeof artifacts = [];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (g.match(remaining[i].artifact.source)) mine.unshift(...remaining.splice(i, 1));
    }
    return { ...g, items: mine };
  }).filter((g) => g.items.length > 0);

  const activeFacts = (facts ?? []).filter((f) => f.status === "active");
  const historicalFacts = (facts ?? []).filter((f) => f.status !== "active");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/memory" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Memory
      </Link>

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          <h1 className="text-gradient text-[22px] font-semibold leading-tight tracking-[-0.02em]">{entity.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CommitmentStatusChip entity={entity} />
            {entity.meta?.to ? <span className="text-xs text-muted-foreground">to {entity.meta.to}</span> : null}
            {entity.meta?.due ? <span className="text-xs text-muted-foreground">· due {entity.meta.due}</span> : null}
          </div>
        </div>
      </div>

      {(activeFacts.length > 0 || historicalFacts.length > 0) && (
        <Card className="mt-6 p-4">
          <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            What Orbit knows
          </div>
          <div className="mt-2 divide-y divide-border/50">
            {activeFacts.map((f) => <FactRow key={f.id} f={f} />)}
            {historicalFacts.map((f) => <FactRow key={f.id} f={f} />)}
          </div>
        </Card>
      )}

      {relatedEntities.length > 0 && (
        <Card className="mt-6 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Connections</div>
          <div className="mt-3 flex flex-col gap-2">
            {relatedEntities.map(({ type, entity: rel }, i) => {
              const rm = entityMeta(rel.kind);
              const RIcon = rm.icon;
              return (
                <Link key={`${rel.id}-${i}`} href={`/memory/${rel.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                  <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{LINK_LABEL[type] ?? type}</span>
                  <RIcon className="h-4 w-4 text-primary" />
                  <span className="truncate">{rel.name}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mt-6 space-y-5">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No linked work yet — it appears as connectors sync.</p>
        ) : (
          groups.map((g) => (
            <Card key={g.label} className="p-4">
              <div className="flex items-center gap-2 px-2">
                {g.logo ? (
                  <IntegrationLogo k={g.logo} className="h-5 w-5 rounded" />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center"><Phone className="h-3.5 w-3.5 text-muted-foreground" /></span>
                )}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.label} · {g.items.length}
                </span>
              </div>
              <div className="mt-1.5 flex flex-col">
                {g.items.slice(0, 12).map(({ type, artifact }, i) => (
                  <WorkRow key={`${artifact.id}-${i}`} type={type} artifact={artifact} />
                ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
