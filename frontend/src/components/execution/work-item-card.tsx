"use client";


import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Check, Pencil, Plug, Trash2, Undo2, UserPlus, X } from "lucide-react";
import type { Member, Task } from "@/lib/types";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Provider = "jira" | "linear";

const PRIORITIES: Task["priority"][] = ["urgent", "high", "medium", "low"];
const PRIORITY_VARIANT: Record<string, "destructive" | "warning" | "default" | "muted"> = {
  urgent: "destructive", high: "warning", medium: "default", low: "muted",
};

// Loose mapping of a work item's discipline to the teammates who could own it.
const DISC_MATCH: Record<string, string[]> = {
  engineering: ["eng"],
  design: ["design"],
  qa: ["qa"],
  sales: ["sales", "account"],
  "customer-success": ["customer success", "success"],
  product: ["product", "founder", "ceo"],
};

function teamFor(discipline: string, members: Member[]): Member[] {
  const keys = DISC_MATCH[discipline] ?? [];
  const matched = members.filter((m) => keys.some((k) => m.title.toLowerCase().includes(k)));
  return matched.length ? matched : members;
}

const PROVIDER_NAME: Record<Provider, string> = { jira: "Jira", linear: "Linear" };

export function WorkItemCard({
  task, members, connectedProvider, canPush, canEdit = true, onChanged, compact = false,
}: {
  task: Task;
  members: Member[];
  connectedProvider: Provider | null;
  canPush: boolean;
  canEdit?: boolean;
  onChanged: () => void;
  compact?: boolean;
}) {
  const declined = task.links?.decision === "declined";
  const pushed = !!task.links?.pushed;
  const reason = (task.links?.reason as string) || "";
  const confidence = task.links?.confidence as number | undefined;
  const [busy, setBusy] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [q, setQ] = React.useState("");

  // Edit mode — Orbit's title/description/priority are a first draft.
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description);
  const [priority, setPriority] = React.useState<Task["priority"]>(task.priority);

  const editable = canEdit && !declined && !pushed;

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); onChanged(); if (msg) toast.success(msg); }
    catch { toast.error("Something went wrong"); }
    finally { setBusy(false); }
  };

  const startEdit = () => {
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setEditing(true);
  };

  const saveEdit = () =>
    run(() => api.patchTask(task.id, { title: title.trim() || task.title, description, priority }), "Work item updated")
      .then(() => setEditing(false));

  const candidates = teamFor(task.discipline, members).filter((m) =>
    q.trim() ? m.name.toLowerCase().includes(q.replace("@", "").trim().toLowerCase()) : true,
  );

  const assign = (m: Member) =>
    run(() => api.patchTask(task.id, { assignee: { id: m.id, name: m.name, title: m.title } }), `Assigned to ${m.name}`)
      .then(() => { setAssignOpen(false); setQ(""); });

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-primary/30 bg-background/40 p-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Work item title" className="h-8 text-sm font-medium" />
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description" className="text-sm" />
        <div className="flex items-center gap-2">
          <Select value={priority} onValueChange={(v) => setPriority(v as Task["priority"])}>
            <SelectTrigger className="h-8 w-32 text-xs capitalize"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" onClick={saveEdit} disabled={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-background/40 p-3", declined && "opacity-55")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[task.priority] ?? "default"} className="capitalize">{task.priority}</Badge>
            {typeof task.estimate === "number" && <span className="text-xs tabular-nums text-muted-foreground">{task.estimate} pts</span>}
            {typeof confidence === "number" && <span className="text-xs text-muted-foreground">· {confidence}% conf</span>}
            {pushed && (
              <Badge variant="success" className="gap-1">
                <Check className="h-3 w-3" /> {task.links?.externalKey} · {PROVIDER_NAME[(task.links?.pushedTo as Provider)] ?? "Pushed"}
              </Badge>
            )}
            {declined && <Badge variant="muted">Declined</Badge>}
          </div>
          <div className={cn("mt-1 text-sm font-medium leading-snug", declined && "line-through")}>{task.title}</div>
          {task.description && !compact && <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>}
        </div>

        {/* Edit / accept / decline */}
        <div className="flex shrink-0 items-center">
          {editable && (
            <Button variant="ghost" size="icon-sm" title="Edit work item" disabled={busy} onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* Accept/decline are review-time decisions — locked with the plan. */}
          {canEdit && (declined ? (
            <Button variant="ghost" size="icon-sm" title="Restore" disabled={busy}
              onClick={() => run(() => api.patchTask(task.id, { decision: "accepted" }), "Restored")}>
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" title="Decline this suggestion" disabled={busy || pushed}
              onClick={() => run(() => api.patchTask(task.id, { decision: "declined" }), "Declined")}>
              <X className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      </div>

      {reason && !compact && (
        <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Why</span>
          <p className="text-xs text-muted-foreground">{reason}</p>
        </div>
      )}

      {!declined && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {/* Assign (@ teammates) — read-only once the plan is approved */}
          {!canEdit ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium">
              <UserPlus className="h-3 w-3 text-muted-foreground" />
              {task.assignee?.name || "Unassigned"}
            </span>
          ) : (
          <Popover open={assignOpen} onOpenChange={setAssignOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:border-primary/40">
                <UserPlus className="h-3 w-3 text-muted-foreground" />
                {task.assignee?.name || "Assign"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-2">
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="@ search teammates" className="h-8 text-xs" />
              <div className="mt-1.5 max-h-48 space-y-0.5 overflow-auto">
                {candidates.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No teammates found</div>}
                {candidates.map((m) => (
                  <button key={m.id} onClick={() => assign(m)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">
                      {m.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </span>
                    <span className="min-w-0"><span className="font-medium">{m.name}</span><span className="block truncate text-muted-foreground">{m.title}</span></span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          )}

          {/* Remove from plan */}
          {editable && !compact && (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" disabled={busy}
              onClick={() => run(() => api.deleteTask(task.id), "Removed from plan")}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}

          {/* Push (post-approve, connection-gated) */}
          {canPush && !pushed && (
            connectedProvider ? (
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={busy}
                onClick={() => run(() => api.pushTask(task.id, connectedProvider), `Pushed to ${PROVIDER_NAME[connectedProvider]}`)}>
                <ArrowUpRight className="h-3.5 w-3.5" /> Push to {PROVIDER_NAME[connectedProvider]}
              </Button>
            ) : (
              <Button asChild size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground">
                <Link href="/integrations"><Plug className="h-3.5 w-3.5" /> Connect a tool to push</Link>
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
