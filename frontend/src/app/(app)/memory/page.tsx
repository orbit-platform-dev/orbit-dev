"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight,
  ChevronRight,
  Database,
  FileText,
  MessageSquare,
  Phone,
  Plus,
  Ticket,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useArtifacts, useEntities, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { Artifact, Entity } from "@/lib/types";
import { entityMeta, CommitmentStatusChip } from "@/components/memory/entity-meta";
import { TimeFilter, withinRange, type TimeRange } from "@/components/shared/time-filter";

const SOURCE_META: Record<string, { label: string; icon: typeof Phone }> = {
  call: { label: "Call", icon: Phone },
  document: { label: "Document", icon: FileText },
  "linear-issue": { label: "Linear", icon: Ticket },
  "slack-message": { label: "Slack", icon: MessageSquare },
};
const sourceMeta = (s: string) => SOURCE_META[s] ?? { label: s, icon: FileText };

// --- Signals (artifacts) ----------------------------------------------------
function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const meta = sourceMeta(artifact.source);
  const Icon = meta.icon;
  const ex = artifact.extracted ?? {};
  const commitments = ex.commitments ?? [];
  const requests = ex.requests ?? [];
  const decisions = ex.decisions ?? [];
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-foreground">{meta.label}</span>
          <span>·</span>
          <span>{timeAgo(artifact.occurredAt)}</span>
          {artifact.status === "stale" && <Badge variant="muted">No longer syncing</Badge>}
        </div>
        {artifact.url ? (
          <a href={artifact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Source <ArrowUpRight className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-[11px] text-muted-foreground">observed</span>
        )}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold leading-snug tracking-tight">{artifact.title}</h3>
      {ex.summary ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ex.summary}</p> : null}
      {(commitments.length > 0 || requests.length > 0 || decisions.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {commitments.length > 0 && <Badge variant="muted">{commitments.length} commitment{commitments.length > 1 ? "s" : ""}</Badge>}
          {requests.length > 0 && <Badge variant="muted">{requests.length} request{requests.length > 1 ? "s" : ""}</Badge>}
          {decisions.length > 0 && <Badge variant="muted">{decisions.length} decision{decisions.length > 1 ? "s" : ""}</Badge>}
        </div>
      )}
    </Card>
  );
}

function SignalsView({ range }: { range: TimeRange }) {
  const { data, isLoading } = useArtifacts();
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }
  const items = (data ?? []).filter((a) => withinRange(a.occurredAt, range));
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title={data && data.length ? "Nothing in this time range" : "Nothing here yet"}
        description="The raw items Orbit has read from your calls and connected tools. Add a call or connect a tool and Orbit keeps this up to date on its own."
        action={<AddCallDialog />}
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((a) => <ArtifactCard key={a.id} artifact={a} />)}
    </div>
  );
}

// --- Entities (company model) -----------------------------------------------
const KIND_ORDER = ["customer", "commitment", "feature", "person", "goal"];

function EntityRow({ entity }: { entity: Entity }) {
  const { icon: Icon } = entityMeta(entity.kind);
  return (
    <Link
      href={`/memory/${entity.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/30 hover:bg-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{entity.name}</span>
      <CommitmentStatusChip entity={entity} />
      <span className="hidden text-xs text-muted-foreground sm:inline">{timeAgo(entity.updatedAt)}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function EntitiesView({ range }: { range: TimeRange }) {
  const { data, isLoading } = useEntities();
  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }
  const filtered = (data ?? []).filter((e) => withinRange(e.updatedAt, range));
  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title={data && data.length ? "Nothing in this time range" : "Nothing here yet"}
        description="What Orbit knows about your company. It resolves customers, commitments and requests from your calls and connected tools. Add a call or connect a tool to start."
        action={<AddCallDialog />}
      />
    );
  }
  const groups = KIND_ORDER.map((kind) => ({ kind, items: filtered.filter((e) => e.kind === kind) })).filter((g) => g.items.length);
  return (
    <div className="space-y-8">
      {groups.map(({ kind, items }) => {
        const { plural, icon: Icon } = entityMeta(kind);
        return (
          <section key={kind}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon className="h-3.5 w-3.5" /> {plural} <span className="text-muted-foreground/60">· {items.length}</span>
            </div>
            <div className="space-y-2">{items.map((e) => <EntityRow key={e.id} entity={e} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

// --- Add call ---------------------------------------------------------------
function AddCallDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const ingest = useMutation({
    mutationFn: () => api.ingestCall({ title: title.trim() || "Customer call", content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.artifacts });
      qc.invalidateQueries({ queryKey: qk.entities });
      toast.success("Call added to company memory");
      setOpen(false);
      setTitle("");
      setContent("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add the call"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add call</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a customer call</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="artifact-title">Title</Label>
            <Input id="artifact-title" placeholder="Acme discovery call" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="artifact-content">Transcript</Label>
            <Textarea
              id="artifact-content"
              placeholder="Paste the call transcript. Orbit reads it, extracts commitments and requests, and connects them to the work being built across your tools."
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => ingest.mutate()} disabled={ingest.isPending || content.trim().split(/\s+/).length < 6}>
            {ingest.isPending ? "Reading…" : "Add to memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Page -------------------------------------------------------------------
export default function MemoryPage() {
  const [range, setRange] = useState<TimeRange>("all");

  return (
    <div>
      <PageHeader
        title="Memory"
        description="What Orbit knows about your company, read automatically from your connected tools and calls. Browse the customers, commitments and requests it resolved, each traceable to where it came from. You never type any of it in."
        actions={<AddCallDialog />}
      />
      <div className="mb-5 flex items-center justify-end gap-3">
        <TimeFilter value={range} onChange={setRange} />
      </div>
      <Tabs defaultValue="knowledge">
        <TabsList className="mb-2">
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>
        <TabsContent value="knowledge">
          <p className="mb-5 text-sm text-muted-foreground">Customers, commitments and requests Orbit resolved from your tools.</p>
          <EntitiesView range={range} />
        </TabsContent>
        <TabsContent value="sources">
          <SignalsView range={range} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
