"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Database, FileText, Phone, Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useEntity } from "@/lib/hooks";
import { timeAgo } from "@/lib/utils";
import { entityMeta, LINK_LABEL, CommitmentStatusChip } from "@/components/memory/entity-meta";
import type { Artifact } from "@/lib/types";

const SOURCE_ICON: Record<string, typeof Phone> = {
  call: Phone,
  document: FileText,
  "linear-issue": Ticket,
};

function ArtifactRow({ type, artifact }: { type: string; artifact: Artifact }) {
  const Icon = SOURCE_ICON[artifact.source] ?? FileText;
  const summary = artifact.extracted?.summary;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {LINK_LABEL[type] ?? type}
          </span>
          <span className="text-xs text-muted-foreground">· {timeAgo(artifact.occurredAt)}</span>
        </div>
        <div className="mt-0.5 text-sm font-medium">{artifact.title}</div>
        {summary ? <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{summary}</p> : null}
      </div>
      {artifact.url ? (
        <a href={artifact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
          Open <ArrowUpRight className="h-3 w-3" />
        </a>
      ) : null}
    </div>
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

  const { entity, artifacts, relatedEntities } = data;
  const { label, icon: Icon } = entityMeta(entity.kind);

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

      <div className="mt-6">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</div>
        {artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No source artifacts linked yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {artifacts.map(({ type, artifact }, i) => <ArtifactRow key={`${artifact.id}-${i}`} type={type} artifact={artifact} />)}
          </div>
        )}
      </div>
    </div>
  );
}
