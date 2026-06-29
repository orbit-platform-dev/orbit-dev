"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Bug, CalendarClock, CheckCircle2, Crosshair, FileText,
  ListChecks, Lock, Mail, Pencil, Plug, Rocket, Sparkles, Trash2, Workflow, X,
} from "lucide-react";
import { qk, useMeeting, useProject, useTasks } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { Project, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { GraphCanvas } from "@/components/graph/graph-canvas";

const DISC: Record<string, { label: string; color: string }> = {
  product: { label: "Product", color: "#8b5cf6" },
  engineering: { label: "Engineering", color: "#0ea5e9" },
  design: { label: "Design", color: "#ec4899" },
  qa: { label: "QA", color: "#10b981" },
  "customer-success": { label: "Customer Success", color: "#14b8a6" },
  sales: { label: "Sales", color: "#f59e0b" },
};
const DISC_ORDER = ["product", "engineering", "design", "qa", "customer-success", "sales"];
const PRIORITY_VARIANT: Record<string, "destructive" | "warning" | "default" | "muted"> = {
  urgent: "destructive", high: "warning", medium: "default", low: "muted",
};

function Section({ icon: Icon, title, hint, action, children }: {
  icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Chips({ items, className }: { items: (string | undefined)[]; className?: string }) {
  const real = items.filter(Boolean) as string[];
  if (!real.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {real.map((t, i) => (
        <span key={i} className="rounded-md border border-border bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">{t}</span>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</div>
      {children}
    </div>
  );
}

// --- Work item row ----------------------------------------------------------
function WorkItemRow({ task, locked, onChanged }: { task: Task; locked: boolean; onChanged: () => void }) {
  const [editingOwner, setEditingOwner] = React.useState(false);
  const [owner, setOwner] = React.useState(task.assignee?.name ?? "");
  const [busy, setBusy] = React.useState(false);
  const reason = (task.links?.reason as string) || "";
  const confidence = task.links?.confidence as number | undefined;

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); onChanged(); toast.success(msg); }
    catch { toast.error("Something went wrong"); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[task.priority] ?? "default"} className="capitalize">{task.priority}</Badge>
            {typeof task.estimate === "number" && <span className="text-xs tabular-nums text-muted-foreground">{task.estimate} pts</span>}
            {typeof confidence === "number" && <span className="text-xs text-muted-foreground">· {confidence}% conf</span>}
          </div>
          <div className="mt-1 text-sm font-medium leading-snug">{task.title}</div>
          {task.description && <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>}
        </div>
        {!locked && (
          <Button variant="ghost" size="icon-sm" title="Skip this item" disabled={busy}
            onClick={() => run(() => api.deleteTask(task.id), "Item skipped")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {reason && (
        <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Why</span>
          <p className="text-xs text-muted-foreground">{reason}</p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Owner:</span>
        {editingOwner && !locked ? (
          <span className="flex items-center gap-1">
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} className="h-7 w-44 text-xs" placeholder="Role / person" />
            <Button size="icon-sm" variant="ghost" disabled={busy}
              onClick={() => run(() => api.patchTask(task.id, { assignee: { name: owner, title: owner } }), "Reassigned").then(() => setEditingOwner(false))}>
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditingOwner(false)}><X className="h-3.5 w-3.5" /></Button>
          </span>
        ) : (
          <button disabled={locked} onClick={() => setEditingOwner(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 font-medium hover:border-primary/40 disabled:opacity-60">
            {task.assignee?.name || "Unassigned"}
            {!locked && <Pencil className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Page -------------------------------------------------------------------
export default function ExecutionReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: m, isLoading } = useMeeting(id);
  const pid = m?.linkedProjectId ?? "";
  const { data: project } = useProject(pid);
  const { data: allTasks } = useTasks();

  const tasks = React.useMemo(() => (allTasks ?? []).filter((t) => t.projectId === pid), [allTasks, pid]);
  const approved = project?.approvalStatus === "approved";
  const [approving, setApproving] = React.useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.tasks });
    qc.invalidateQueries({ queryKey: qk.project(pid) });
    qc.invalidateQueries({ queryKey: qk.meeting(id) });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!m) return <EmptyState icon={FileText} title="Meeting not found" description="This meeting may have been deleted." />;
  if (!project) {
    return (
      <div className="space-y-4">
        <Back id={id} />
        <EmptyState icon={Sparkles} title="No execution plan yet"
          description="Analyze this meeting's transcript first — Orbit will generate a plan you can review and approve." />
      </div>
    );
  }

  const a = m.analysis;
  const prd = project.prd;
  const cu = project.customerUpdate;
  const tl = project.timeline;

  const approve = async () => {
    setApproving(true);
    try {
      await api.approveExecution(id);
      invalidate();
      toast.success("Execution plan approved");
    } catch { toast.error("Could not approve — is the backend running?"); }
    finally { setApproving(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-28">
      <Back id={id} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review execution plan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.name} · from the {m.account} call. Orbit proposes — you approve, edit or skip before anything ships.
          </p>
        </div>
        {typeof a?.confidence === "number" && (
          <div className="shrink-0 rounded-lg border border-border bg-card px-3 py-2 text-center">
            <div className="text-lg font-semibold tabular-nums">{a.confidence}%</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Intent confidence</div>
          </div>
        )}
      </div>

      {approved && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-success/40 bg-success/5 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div className="flex-1">
                <div className="text-sm font-semibold">Execution Plan Approved</div>
                <div className="text-xs text-muted-foreground">Ready for synchronization. Integration push (Jira / Linear) comes next.</div>
              </div>
              <Badge variant="success" className="gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
            </div>
          </Card>
        </motion.div>
      )}

      {/* 1. Customer Intent */}
      <Section icon={Crosshair} title="Customer Intent" hint="What the customer actually needs, extracted from the call.">
        {a?.summary && <p className="text-sm text-muted-foreground">{a.summary}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {!!a?.featureRequests?.length && (
            <Field label="Feature requests"><Chips items={a.featureRequests.map((f) => f.title)} /></Field>
          )}
          {!!a?.bugs?.length && (
            <Field label="Bugs">
              <div className="space-y-1">
                {a.bugs.map((b) => (
                  <div key={b.id} className="flex items-center gap-1.5 text-xs"><Bug className="h-3 w-3 text-destructive" /> {b.title}</div>
                ))}
              </div>
            </Field>
          )}
          {!!a?.customerGoals?.length && <Field label="Goals"><Chips items={a.customerGoals} /></Field>}
          {!!a?.deadlines?.length && (
            <Field label="Deadlines">
              <div className="space-y-1">
                {a.deadlines.map((d) => (
                  <div key={d.id} className="flex items-center gap-1.5 text-xs"><CalendarClock className="h-3 w-3 text-warning" /> {d.title} — <span className="font-medium">{d.due}</span></div>
                ))}
              </div>
            </Field>
          )}
          {!!a?.requestedIntegrations?.length && (
            <Field label="Requested integrations">
              <div className="flex flex-wrap gap-1.5">
                {a.requestedIntegrations.map((it) => (
                  <span key={it} className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-0.5 text-xs"><Plug className="h-3 w-3" /> {it}</span>
                ))}
              </div>
            </Field>
          )}
          {!!a?.painPoints?.length && <Field label="Pain points"><Chips items={a.painPoints.map((p) => p.title)} /></Field>}
        </div>
      </Section>

      {/* 2. PRD */}
      <PrdSection project={project} locked={approved} onSaved={invalidate} />

      {/* 3. Execution Plan */}
      <Section icon={ListChecks} title="Execution Plan" hint={`${tasks.length} work items across the relevant teams — each explains why.`}>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work items generated.</p>
        ) : (
          <div className="space-y-4">
            {DISC_ORDER.filter((d) => tasks.some((t) => t.discipline === d)).map((disc) => {
              const meta = DISC[disc] ?? { label: disc, color: "#888" };
              const items = tasks.filter((t) => t.discipline === disc);
              return (
                <div key={disc}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-xs text-muted-foreground">· {items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((t) => <WorkItemRow key={t.id} task={t} locked={approved} onChanged={invalidate} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 4. Timeline */}
      {tl && (
        <Section icon={CalendarClock} title="Timeline" hint={`${tl.deliveryEstimate} · ${tl.confidence}% confidence`}>
          <TimelineBar timeline={tl} />
          {!!tl.criticalPath?.length && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground/70">Critical path:</span>
              <Chips items={tl.criticalPath} />
            </div>
          )}
        </Section>
      )}

      {/* 5. Customer Email */}
      <EmailSection project={project} locked={approved} onSaved={invalidate} />

      {/* 6. Execution Graph */}
      <Section icon={Workflow} title="Execution Graph" hint="Every artifact, connected — click any node to trace it back."
        action={<Button asChild variant="outline" size="sm" className="gap-1.5"><Link href={`/graph?meeting=${id}`}><Workflow className="h-3.5 w-3.5" /> Open full graph</Link></Button>}>
        <div className="h-[460px] overflow-hidden rounded-lg border border-border">
          <GraphCanvas meetingId={id} />
        </div>
      </Section>

      {/* Sticky approve bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="text-sm">
            {approved ? (
              <span className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> Approved — ready for synchronization.</span>
            ) : (
              <span className="text-muted-foreground">Review the plan above, then approve to finalize it.</span>
            )}
          </div>
          <Button onClick={approve} disabled={approved || approving} className="gap-2">
            {approved ? <><Lock className="h-4 w-4" /> Approved</> : <><Rocket className="h-4 w-4" /> {approving ? "Approving…" : "Approve execution plan"}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Back({ id }: { id: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
      <Link href={`/meetings/${id}`}><ArrowLeft className="h-4 w-4" /> Back to meeting</Link>
    </Button>
  );
}

function TimelineBar({ timeline }: { timeline: NonNullable<Project["timeline"]> }) {
  const total = Math.max(1, timeline.durationWeeks);
  return (
    <div>
      <div className="relative h-2 rounded-full bg-secondary">
        {timeline.milestones.map((ms, i) => (
          <div key={i} className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
            style={{ left: `${Math.min(100, (ms.week / total) * 100)}%` }} title={`${ms.title} · week ${ms.week}`} />
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {timeline.milestones.map((ms, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <Badge variant="muted" className="tabular-nums">wk {ms.week}</Badge>
            <div><div className="font-medium">{ms.title}</div><div className="text-muted-foreground">{ms.description}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrdSection({ project, locked, onSaved }: { project: Project; locked: boolean; onSaved: () => void }) {
  const prd = project.prd;
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(prd?.title ?? project.name);
  const [problem, setProblem] = React.useState(prd?.problem ?? "");
  const [busy, setBusy] = React.useState(false);
  if (!prd) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { prd: { ...prd, title, problem } });
      onSaved(); setEditing(false); toast.success("PRD updated");
    } catch { toast.error("Could not save PRD"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={FileText} title="Draft PRD" hint="Editable — Orbit's first draft."
      action={!locked && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>)}>
      {editing ? (
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Problem"><Textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} /></Field>
        </div>
      ) : (
        <>
          <h3 className="text-base font-semibold">{prd.title || project.name}</h3>
          {prd.problem && <p className="mt-1 text-sm text-muted-foreground">{prd.problem}</p>}
          {prd.background && <p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground/70">Background: </span>{prd.background}</p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {!!prd.goals?.length && <Field label="Goals"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.goals.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.functionalRequirements?.length && <Field label="Functional requirements"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.functionalRequirements.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.acceptanceCriteria?.length && <Field label="Acceptance criteria"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.acceptanceCriteria.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.risks?.length && <Field label="Risks"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.risks.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.dependencies?.length && <Field label="Dependencies"><Chips items={prd.dependencies} /></Field>}
            {!!prd.successMetrics?.length && <Field label="Success metrics"><div className="space-y-1">{prd.successMetrics.map((s, i) => <div key={i} className="flex justify-between gap-2 text-sm"><span className="text-muted-foreground">{s.metric}</span><span className="font-medium">{s.target}</span></div>)}</div></Field>}
          </div>
        </>
      )}
    </Section>
  );
}

function EmailSection({ project, locked, onSaved }: { project: Project; locked: boolean; onSaved: () => void }) {
  const cu = project.customerUpdate;
  const skipped = cu?.skipped;
  const [editing, setEditing] = React.useState(false);
  const [subject, setSubject] = React.useState(cu?.subject ?? "");
  const [body, setBody] = React.useState(cu?.body ?? "");
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { customerUpdate: { ...cu, subject, body } });
      onSaved(); setEditing(false); toast.success("Follow-up updated");
    } catch { toast.error("Could not save email"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={Mail} title="Customer Follow-up" hint="Editable draft — sending is mocked for now."
      action={!locked && !skipped && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>)}>
      {skipped ? (
        <p className="text-sm text-muted-foreground">Skipped — {cu?.reason || "no follow-up needed."}</p>
      ) : editing ? (
        <div className="space-y-3">
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} /></Field>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background/40 p-4">
          <div className="text-sm font-semibold">{cu?.subject || "Follow-up"}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{cu?.body}</p>
          {!!cu?.commitments?.length && (
            <div className="mt-3"><Field label="Commitments"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{cu.commitments.map((c, i) => <li key={i}>{c}</li>)}</ul></Field></div>
          )}
        </div>
      )}
    </Section>
  );
}
