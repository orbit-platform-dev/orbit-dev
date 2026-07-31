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
  // Plus,  (used only by the Add-call button, hidden for MVP)
  Ticket,
} from "lucide-react";
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
import { useArtifacts, useEntities, useHeartbeat, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import type { Artifact, Entity } from "@/lib/types";
import { entityMeta, CommitmentStatusChip } from "@/components/memory/entity-meta";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { MemoryTheater } from "@/components/shared/memory-theater";
import { sourceKey } from "@/lib/sources";

const SOURCE_LABEL: Record<string, string> = {
  call: "Call",
  document: "Document",
  "linear-issue": "Linear",
  "slack-message": "Slack",
  "github-pr": "GitHub PR",
  "github-issue": "GitHub issue",
  "gdrive-doc": "Google Doc",
  "gdrive-sheet": "Google Sheet",
  "gdrive-slides": "Google Slides",
  "gdrive-pdf": "PDF (Drive)",
  "gdrive-image": "Image (Drive)",
  "notion-page": "Notion page",
  "confluence-page": "Confluence page",
  fireflies: "Fireflies",
  circleback: "Circleback",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

// --- Sources: a provenance INDEX, not a mirror of your tools -----------------
// One compact row per item — what Orbit read and what it extracted. The full
// content lives in the tool itself (that's what the deep link is for).
function SourceRow({ artifact }: { artifact: Artifact }) {
  const key = sourceKey(artifact.source);
  const ex = artifact.extracted ?? {};
  const extractedBits = [
    (ex.commitments?.length ?? 0) > 0
      ? `${ex.commitments!.length} commitment${ex.commitments!.length > 1 ? "s" : ""}`
      : null,
    (ex.decisions?.length ?? 0) > 0
      ? `${ex.decisions!.length} decision${ex.decisions!.length > 1 ? "s" : ""}`
      : null,
    (ex.requests?.length ?? 0) > 0
      ? `${ex.requests!.length} request${ex.requests!.length > 1 ? "s" : ""}`
      : null,
  ].filter(Boolean);

  const inner = (
    <>
      {key ? (
        <IntegrationLogo k={key} className="h-8 w-8 rounded-lg" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
          {artifact.source === "call" ? (
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{artifact.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {sourceLabel(artifact.source)} · {timeAgo(artifact.occurredAt)}
          {extractedBits.length > 0 ? <> · learned {extractedBits.join(", ")}</> : null}
          {artifact.status === "stale" ? <Badge variant="muted">No longer syncing</Badge> : null}
        </span>
      </span>
      {artifact.url ? (
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  const cls =
    "flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-all duration-200 hover:-translate-y-px hover:border-primary/30 hover:shadow-md hover:shadow-primary/5";
  return artifact.url ? (
    <a href={artifact.url} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function SignalsView() {
  const { data, isLoading } = useArtifacts();
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  const items = data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="Nothing here yet"
        description="The raw items Orbit has read from your calls and connected tools. Add a call or connect a tool and Orbit keeps this up to date on its own."
        action={<AddCallDialog />}
      />
    );
  }
  // Coverage at a glance: what Orbit is reading, per tool.
  const counts = new Map<string, number>();
  for (const a of items) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from(counts.entries()).map(([source, n]) => {
          const key = sourceKey(source);
          return (
            <span
              key={source}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
            >
              {key ? (
                <IntegrationLogo k={key} className="h-4 w-4 rounded-[4px] border-0" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
              <span className="font-medium text-foreground">{sourceLabel(source)}</span> {n}
            </span>
          );
        })}
      </div>
      <div className="space-y-2">
        {items.map((a) => (
          <SourceRow key={a.id} artifact={a} />
        ))}
      </div>
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
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-px hover:border-primary/30 hover:bg-accent hover:shadow-md hover:shadow-primary/5"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{entity.name}</span>
      <CommitmentStatusChip entity={entity} />
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {timeAgo(entity.updatedAt)}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function EntitiesView() {
  const { data, isLoading } = useEntities();
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }
  const all = data ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="Nothing here yet"
        description="What Orbit knows about your company. It resolves customers, commitments and requests from your calls and connected tools. Add a call or connect a tool to start."
        action={<AddCallDialog />}
      />
    );
  }
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: all.filter((e) => e.kind === kind),
  })).filter((g) => g.items.length);
  return (
    <div className="space-y-8">
      {groups.map(({ kind, items }) => {
        const { plural, icon: Icon } = entityMeta(kind);
        return (
          <section key={kind}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon className="h-3.5 w-3.5" /> {plural}{" "}
              <span className="text-muted-foreground/60">· {items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((e) => (
                <EntityRow key={e.id} entity={e} />
              ))}
            </div>
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a customer call</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="artifact-title">Title</Label>
            <Input
              id="artifact-title"
              placeholder="Acme discovery call"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
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
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => ingest.mutate()}
            disabled={ingest.isPending || content.trim().split(/\s+/).length < 6}
          >
            {ingest.isPending ? "Reading…" : "Add to memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Page -------------------------------------------------------------------
export default function MemoryPage() {
  const { data: hb } = useHeartbeat();
  const sync = hb?.sync;
  return (
    <div>
      {sync?.active ? (
        <MemoryTheater sync={sync} />
      ) : (
        <>
          <Tabs defaultValue="knowledge">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
                <TabsTrigger value="sources">Sources</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="knowledge">
              <EntitiesView />
            </TabsContent>
            <TabsContent value="sources">
              <SignalsView />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
