"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowUpRight, Bug, CalendarClock, CheckCircle2, Contact, Crosshair,
  FileDown, FileText, ListChecks, Loader2, Lock, Mail, Pencil, Plug, Rocket,
  Send, Sparkles,
} from "lucide-react";
import { qk, useConnectedProvider, useIntegrations, useMeeting, useProject, useSyncJobs, useTasks } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { MeetingAnalysis, Project, SyncJob, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { WorkItemCard } from "@/components/execution/work-item-card";
import { ObjectList, StringList } from "@/components/execution/editable";
import { downloadPrdPdf } from "@/components/execution/prd-pdf";
import { downloadPlanPdf } from "@/components/execution/plan-pdf";

const DISC: Record<string, { label: string; color: string }> = {
  product: { label: "Product", color: "#8b5cf6" },
  engineering: { label: "Engineering", color: "#0ea5e9" },
  design: { label: "Design", color: "#ec4899" },
  qa: { label: "QA", color: "#10b981" },
  "customer-success": { label: "Customer Success", color: "#14b8a6" },
  sales: { label: "Sales", color: "#f59e0b" },
};
const DISC_ORDER = ["product", "engineering", "design", "qa", "customer-success", "sales"];

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

// --- Page -------------------------------------------------------------------
export default function ExecutionReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: m, isLoading } = useMeeting(id);
  const pid = m?.linkedProjectId ?? "";
  const { data: project } = useProject(pid);
  const { data: allTasks } = useTasks();

  const connectedProvider = useConnectedProvider();
  const members = api.directory.members;
  const tasks = React.useMemo(() => (allTasks ?? []).filter((t) => t.projectId === pid), [allTasks, pid]);
  const approved = project?.approvalStatus === "approved";
  const [approving, setApproving] = React.useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.tasks });
    qc.invalidateQueries({ queryKey: qk.project(pid) });
    qc.invalidateQueries({ queryKey: qk.meeting(id) });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!m) return <EmptyState icon={FileText} title="Signal not found" description="This signal may have been deleted." />;
  if (!project) {
    return (
      <div className="space-y-4">
        <Back id={id} />
        <EmptyState icon={Sparkles} title="No proposal yet"
          description="Analyze this signal first. Orbit will draft a proposal you can review and approve." />
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
      toast.success("Proposal approved");
    } catch { toast.error("Could not approve — is the backend running?"); }
    finally { setApproving(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-28">
      <Back id={id} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review proposal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.name} · from the {m.account} call. Orbit proposes. You approve, edit or skip before anything changes.
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
                <div className="text-sm font-semibold">Proposal approved</div>
                <div className="text-xs text-muted-foreground">Locked — nothing can change now. Run each prepared update below when you&apos;re ready; your tools stay the system of record.</div>
              </div>
              <Badge variant="success" className="gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
            </div>
          </Card>
        </motion.div>
      )}

      {/* 1. Customer Intent */}
      {a && <IntentSection meetingId={id} analysis={a} locked={approved} onSaved={invalidate} />}

      {/* 2. CRM Update proposal */}
      <CrmSection project={project} locked={approved} onSaved={invalidate} />

      {/* 3. PRD */}
      <PrdSection project={project} locked={approved} onSaved={invalidate} />

      {/* 4. Work items */}
      <Section icon={ListChecks} title="Work items" hint={`${tasks.length} work items across the relevant teams — each explains why.`}
        action={
          <div className="flex items-center gap-1.5">
            {tasks.length > 0 && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
                onClick={() => downloadPlanPdf(tasks.filter((t) => t.links?.decision !== "declined"), project.name)}>
                <FileDown className="h-3.5 w-3.5" /> PDF
              </Button>
            )}
            <SectionSync planId={pid} kind="create-tasks" approved={approved} onDone={invalidate} />
          </div>
        }>
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
                    {items.map((t) => (
                      <WorkItemCard key={t.id} task={t} members={members} connectedProvider={connectedProvider} canPush={false} canEdit={!approved} onChanged={invalidate} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 4. Timeline */}
      {tl && <TimelineSection project={project} locked={approved} onSaved={invalidate} />}

      {/* 5. Customer Email */}
      <EmailSection project={project} locked={approved} onSaved={invalidate} />

      {/* Sticky approve bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="text-sm">
            {approved ? (
              <span className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> Approved and locked — use each section&apos;s push button to sync.</span>
            ) : (
              <span className="text-muted-foreground">Review the plan above, then approve to lock it. Nothing is sent until you push it.</span>
            )}
          </div>
          <Button onClick={approve} disabled={approved || approving} className="gap-2">
            {approved ? <><Lock className="h-4 w-4" /> Approved</> : <><Rocket className="h-4 w-4" /> {approving ? "Approving…" : "Approve proposal"}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Per-section synchronization ---------------------------------------------
// Every pushable section carries its own push button: disabled until the plan
// is approved AND the destination tool is connected; "Synced" once delivered.
const SYNC_META: Record<Exclude<SyncJob["kind"], "send-email">, {
  label: string; keys: string[]; connectHint: string;
}> = {
  "crm-update": { label: "Sync CRM", keys: ["salesforce", "hubspot"], connectHint: "CRM sync is on the roadmap — no CRM connects yet" },
  "publish-prd": { label: "Publish", keys: ["notion", "confluence", "google-docs"], connectHint: "Doc publishing is on the roadmap — use the PDF export" },
  "create-tasks": { label: "Create issues", keys: ["linear", "jira"], connectHint: "Connect Linear to create real issues" },
};

function SectionSync({ planId, kind, approved, onDone }: {
  planId: string; kind: keyof typeof SYNC_META; approved: boolean; onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: jobs } = useSyncJobs(planId, approved);
  const { data: integrations } = useIntegrations();
  const [busy, setBusy] = React.useState(false);

  const meta = SYNC_META[kind];
  const job = jobs?.find((j) => j.kind === kind);
  const connected = meta.keys.some((k) =>
    integrations?.some((i) => i.key === k && (i.status === "connected" || i.status === "syncing")));

  if (approved && job?.status === "done") {
    const url = (job.result as { url?: string } | null)?.url;
    return (
      <div className="flex items-center gap-1.5">
        {url && (
          <Button asChild size="sm" variant="ghost" className="gap-1 text-xs text-muted-foreground">
            <a href={url} target="_blank" rel="noreferrer">Open <ArrowUpRight className="h-3 w-3" /></a>
          </Button>
        )}
        <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Synced</Badge>
      </div>
    );
  }

  const hint = !approved ? "Enabled after approval" : !connected ? meta.connectHint : undefined;
  const run = async () => {
    if (!job) return;
    setBusy(true);
    try {
      await api.runSyncJob(planId, job.id);
      qc.invalidateQueries({ queryKey: qk.syncJobs(planId) });
      onDone();
      toast.success(`${meta.label} — synchronized`);
    } catch (err) { toast.error("Couldn't sync", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <Button size="sm" variant="outline" className="gap-1.5" title={hint}
      disabled={!approved || !connected || !job || busy} onClick={run}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
      {job?.status === "failed" ? "Retry" : meta.label}
    </Button>
  );
}

function Back({ id }: { id: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
      <Link href={`/signals/${id}`}><ArrowLeft className="h-4 w-4" /> Back to signal</Link>
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

type PrdDraft = {
  title: string; problem: string; background: string;
  goals: string[]; nonGoals: string[]; functionalRequirements: string[];
  acceptanceCriteria: string[]; dependencies: string[]; risks: string[];
  successMetrics: { metric: string; target: string }[];
  userStories: { id: string; persona: string; story: string; priority: "P0" | "P1" | "P2" }[];
};

function clonePrd(prd: Project["prd"], fallbackTitle: string): PrdDraft {
  return {
    title: prd?.title ?? fallbackTitle,
    problem: prd?.problem ?? "",
    background: prd?.background ?? "",
    goals: [...(prd?.goals ?? [])],
    nonGoals: [...(prd?.nonGoals ?? [])],
    functionalRequirements: [...(prd?.functionalRequirements ?? [])],
    acceptanceCriteria: [...(prd?.acceptanceCriteria ?? [])],
    dependencies: [...(prd?.dependencies ?? [])],
    risks: [...(prd?.risks ?? [])],
    successMetrics: (prd?.successMetrics ?? []).map((s) => ({ ...s })),
    userStories: (prd?.userStories ?? []).map((s) => ({ ...s })),
  };
}

function PrdSection({ project, locked, onSaved }: { project: Project; locked: boolean; onSaved: () => void }) {
  const prd = project.prd;
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [draft, setDraft] = React.useState(() => clonePrd(prd, project.name));
  React.useEffect(() => { if (!editing) setDraft(clonePrd(prd, project.name)); }, [prd, project.name, editing]);
  const set = <K extends keyof PrdDraft>(k: K, v: PrdDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const generate = async () => {
    setGenerating(true);
    try {
      await api.generatePrd(project.id);
      onSaved(); toast.success("PRD drafted — review and edit it below");
    } catch (err) { toast.error("Couldn't generate the PRD", { description: (err as Error).message }); }
    finally { setGenerating(false); }
  };

  // No PRD until a human asks for one.
  if (!prd) {
    return (
      <Section icon={FileText} title="PRD" hint="Generated on demand — from this signal plus the customer's history.">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            {locked
              ? "This plan was approved without a PRD."
              : "No PRD yet. Orbit will draft one from the customer intent above and everything it knows about this customer."}
          </p>
          {!locked && (
            <Button onClick={generate} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "Generating…" : "Generate PRD"}
            </Button>
          )}
        </div>
      </Section>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { prd: { ...prd, ...draft } });
      onSaved(); setEditing(false); toast.success("PRD updated");
    } catch { toast.error("Could not save PRD"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={FileText} title="PRD" hint={locked ? "Approved." : "Editable — Orbit's first draft."}
      action={editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
              onClick={() => downloadPrdPdf(prd, project.name)}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
            <SectionSync planId={project.id} kind="publish-prd" approved={locked} onDone={onSaved} />
            {!locked && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
          </div>}>
      {editing ? (
        <div className="space-y-4">
          <Field label="Title"><Input value={draft.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Problem"><Textarea value={draft.problem} onChange={(e) => set("problem", e.target.value)} rows={3} /></Field>
          <Field label="Background"><Textarea value={draft.background} onChange={(e) => set("background", e.target.value)} rows={2} /></Field>
          <Field label="Goals"><StringList value={draft.goals} onChange={(v) => set("goals", v)} placeholder="Goal" addLabel="Add goal" /></Field>
          <Field label="Non-goals"><StringList value={draft.nonGoals} onChange={(v) => set("nonGoals", v)} placeholder="Out of scope" addLabel="Add non-goal" /></Field>
          <Field label="Functional requirements"><StringList value={draft.functionalRequirements} onChange={(v) => set("functionalRequirements", v)} placeholder="The system must…" addLabel="Add requirement" /></Field>
          <Field label="Acceptance criteria"><StringList value={draft.acceptanceCriteria} onChange={(v) => set("acceptanceCriteria", v)} placeholder="Testable condition" addLabel="Add criterion" /></Field>
          <Field label="Dependencies"><StringList value={draft.dependencies} onChange={(v) => set("dependencies", v)} placeholder="Dependency" addLabel="Add dependency" /></Field>
          <Field label="Risks"><StringList value={draft.risks} onChange={(v) => set("risks", v)} placeholder="Risk" addLabel="Add risk" /></Field>
          <Field label="Success metrics">
            <ObjectList value={draft.successMetrics} onChange={(v) => set("successMetrics", v)} addLabel="Add metric" blank={() => ({ metric: "", target: "" })}>
              {(m, setM) => (
                <div className="flex gap-1.5">
                  <Input value={m.metric} onChange={(e) => setM({ metric: e.target.value })} placeholder="Metric" className="h-8 text-sm" />
                  <Input value={m.target} onChange={(e) => setM({ target: e.target.value })} placeholder="Target" className="h-8 w-32 text-sm" />
                </div>
              )}
            </ObjectList>
          </Field>
          <Field label="User stories">
            <ObjectList value={draft.userStories} onChange={(v) => set("userStories", v)} addLabel="Add story"
              blank={() => ({ id: `us_${Date.now()}`, persona: "", story: "", priority: "P1" as const })}>
              {(s, setS) => (
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <Input value={s.persona} onChange={(e) => setS({ persona: e.target.value })} placeholder="Persona" className="h-8 w-40 text-sm" />
                    <Select value={s.priority} onValueChange={(v) => setS({ priority: v as "P0" | "P1" | "P2" })}>
                      <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{["P0", "P1", "P2"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Input value={s.story} onChange={(e) => setS({ story: e.target.value })} placeholder="As a … I want … so that …" className="h-8 text-sm" />
                </div>
              )}
            </ObjectList>
          </Field>
        </div>
      ) : (
        <>
          <h3 className="text-base font-semibold">{prd.title || project.name}</h3>
          {prd.problem && <p className="mt-1 text-sm text-muted-foreground">{prd.problem}</p>}
          {prd.background && <p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground/70">Background: </span>{prd.background}</p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {!!prd.goals?.length && <Field label="Goals"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.goals.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.nonGoals?.length && <Field label="Non-goals"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.nonGoals.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.functionalRequirements?.length && <Field label="Functional requirements"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.functionalRequirements.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.acceptanceCriteria?.length && <Field label="Acceptance criteria"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.acceptanceCriteria.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.risks?.length && <Field label="Risks"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{prd.risks.map((g, i) => <li key={i}>{g}</li>)}</ul></Field>}
            {!!prd.dependencies?.length && <Field label="Dependencies"><Chips items={prd.dependencies} /></Field>}
            {!!prd.successMetrics?.length && <Field label="Success metrics"><div className="space-y-1">{prd.successMetrics.map((s, i) => <div key={i} className="flex justify-between gap-2 text-sm"><span className="text-muted-foreground">{s.metric}</span><span className="font-medium">{s.target}</span></div>)}</div></Field>}
          </div>
          {!!prd.userStories?.length && (
            <div className="mt-4">
              <Field label="User stories">
                <div className="space-y-1.5">
                  {prd.userStories.map((s) => (
                    <div key={s.id} className="text-sm text-muted-foreground">
                      <Badge variant="muted" className="mr-1.5">{s.priority}</Badge>
                      <span className="font-medium text-foreground/80">{s.persona}: </span>{s.story}
                    </div>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

type CrmDraft = {
  accountSummary: string; opportunityStage: string; riskLevel: string;
  nextSteps: string[]; fieldUpdates: { field: string; value: string; reason: string }[];
};

function cloneCrm(crm: Project["crmUpdate"]): CrmDraft {
  return {
    accountSummary: crm?.accountSummary ?? "",
    opportunityStage: crm?.opportunityStage ?? "",
    riskLevel: crm?.riskLevel ?? "low",
    nextSteps: [...(crm?.nextSteps ?? [])],
    fieldUpdates: (crm?.fieldUpdates ?? []).map((f) => ({ ...f })),
  };
}

const RISK_COLOR: Record<string, string> = { low: "#10b981", medium: "#f59e0b", high: "#ef4444" };

function CrmSection({ project, locked, onSaved }: { project: Project; locked: boolean; onSaved: () => void }) {
  const crm = project.crmUpdate;
  const skipped = crm?.skipped;
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => cloneCrm(crm));
  React.useEffect(() => { if (!editing) setDraft(cloneCrm(crm)); }, [crm, editing]);
  if (!crm) return null;
  const set = <K extends keyof CrmDraft>(k: K, v: CrmDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { crmUpdate: { ...crm, ...draft } });
      onSaved(); setEditing(false); toast.success("CRM update edited");
    } catch { toast.error("Could not save CRM update"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={Contact} title="CRM Update" hint="Proposed account-record changes — reaches your CRM only when you push it."
      action={!skipped && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <div className="flex items-center gap-1.5">
            <SectionSync planId={project.id} kind="crm-update" approved={locked} onDone={onSaved} />
            {!locked && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
          </div>)}>
      {skipped ? (
        <p className="text-sm text-muted-foreground">Skipped — {crm?.reason || "nothing here changes the account record."}</p>
      ) : editing ? (
        <div className="space-y-3">
          <Field label="Account summary"><Textarea value={draft.accountSummary} onChange={(e) => set("accountSummary", e.target.value)} rows={3} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Opportunity stage"><Input value={draft.opportunityStage} onChange={(e) => set("opportunityStage", e.target.value)} /></Field>
            <Field label="Risk level">
              <Select value={draft.riskLevel} onValueChange={(v) => set("riskLevel", v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{["low", "medium", "high"].map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Next steps"><StringList value={draft.nextSteps} onChange={(v) => set("nextSteps", v)} placeholder="Next step" addLabel="Add step" /></Field>
          <Field label="Field updates">
            <ObjectList value={draft.fieldUpdates} onChange={(v) => set("fieldUpdates", v)} addLabel="Add field update"
              blank={() => ({ field: "", value: "", reason: "" })}>
              {(f, setF) => (
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <Input value={f.field} onChange={(e) => setF({ field: e.target.value })} placeholder="Field" className="h-8 w-40 text-sm" />
                    <Input value={f.value} onChange={(e) => setF({ value: e.target.value })} placeholder="Value" className="h-8 text-sm" />
                  </div>
                  <Input value={f.reason} onChange={(e) => setF({ reason: e.target.value })} placeholder="Why (signal evidence)" className="h-8 text-sm" />
                </div>
              )}
            </ObjectList>
          </Field>
        </div>
      ) : (
        <>
          {crm.accountSummary && <p className="text-sm text-muted-foreground">{crm.accountSummary}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {crm.opportunityStage && <Badge variant="muted">Stage: {crm.opportunityStage}</Badge>}
            {crm.riskLevel && (
              <Badge variant="muted" className="gap-1.5 capitalize">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLOR[crm.riskLevel] ?? "#888" }} />
                {crm.riskLevel} risk
              </Badge>
            )}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {!!crm.nextSteps?.length && (
              <Field label="Next steps"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{crm.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul></Field>
            )}
            {!!crm.fieldUpdates?.length && (
              <Field label="Field updates">
                <div className="space-y-1.5">
                  {crm.fieldUpdates.map((f, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium text-foreground/80">{f.field}:</span>{" "}
                      <span className="text-muted-foreground">{f.value}</span>
                      {f.reason && <div className="text-xs text-muted-foreground/70">{f.reason}</div>}
                    </div>
                  ))}
                </div>
              </Field>
            )}
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
  const [to, setTo] = React.useState(cu?.to ?? "");
  const [subject, setSubject] = React.useState(cu?.subject ?? "");
  const [body, setBody] = React.useState(cu?.body ?? "");
  const [commitments, setCommitments] = React.useState<string[]>(cu?.commitments ?? []);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!editing) {
      setTo(cu?.to ?? ""); setSubject(cu?.subject ?? ""); setBody(cu?.body ?? ""); setCommitments(cu?.commitments ?? []);
    }
  }, [cu, editing]);

  // Sending is a sync job: prepared at approval, executed only by this button.
  const qc = useQueryClient();
  const { data: jobs } = useSyncJobs(project.id, locked);
  const emailJob = jobs?.find((j) => j.kind === "send-email");
  const sent = emailJob?.status === "done";
  const [sending, setSending] = React.useState(false);
  const recipient = (cu?.to ?? to).trim();

  const send = async () => {
    if (!emailJob) return;
    setSending(true);
    try {
      await api.runSyncJob(project.id, emailJob.id, recipient);
      qc.invalidateQueries({ queryKey: qk.syncJobs(project.id) });
      toast.success(`Recorded as sent to ${recipient}`, { description: "Email delivery is on the roadmap — send it from your email client." });
    } catch (err) { toast.error("Couldn't send", { description: (err as Error).message }); }
    finally { setSending(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { customerUpdate: { ...cu, to: to.trim(), subject, body, commitments } });
      onSaved(); setEditing(false); toast.success("Follow-up updated");
    } catch { toast.error("Could not save email"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={Mail} title="Customer Follow-up"
      hint={locked ? "Approved — send it when you're ready." : "Editable draft — nothing is sent before approval."}
      action={!skipped && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <div className="flex items-center gap-1.5">
            {!locked && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
            {locked && emailJob && (sent ? (
              <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Sent</Badge>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={send} disabled={sending || !recipient}
                title={recipient ? undefined : "Add a recipient first"}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Mark as sent
              </Button>
            ))}
          </div>)}>
      {skipped ? (
        <p className="text-sm text-muted-foreground">Skipped — {cu?.reason || "no follow-up needed."}</p>
      ) : editing ? (
        <div className="space-y-3">
          <Field label="To"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@company.com" /></Field>
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} /></Field>
          <Field label="Commitments"><StringList value={commitments} onChange={setCommitments} placeholder="What we committed to" addLabel="Add commitment" /></Field>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background/40 p-4">
          {/* Recipient: auto-assigned from the customer's learned contact; delivery
              metadata stays settable after approval (the content is what's locked). */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground/70">To</span>
            {cu?.to ? (
              <span className="rounded-md border border-border bg-card px-2 py-0.5 font-medium text-foreground/80">{cu.to}</span>
            ) : locked && !sent ? (
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@company.com"
                className="h-7 max-w-60 text-xs" />
            ) : (
              <span className="italic">no recipient yet</span>
            )}
          </div>
          <div className="mt-3 text-sm font-semibold">{cu?.subject || "Follow-up"}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{cu?.body}</p>
          {!!cu?.commitments?.length && (
            <div className="mt-3"><Field label="Commitments"><ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{cu.commitments.map((c, i) => <li key={i}>{c}</li>)}</ul></Field></div>
          )}
        </div>
      )}
    </Section>
  );
}

type IntentDraft = {
  summary: string;
  featureRequests: MeetingAnalysis["featureRequests"];
  bugs: NonNullable<MeetingAnalysis["bugs"]>;
  customerGoals: string[];
  deadlines: NonNullable<MeetingAnalysis["deadlines"]>;
  requestedIntegrations: string[];
  painPoints: MeetingAnalysis["painPoints"];
};

function cloneIntent(a: MeetingAnalysis): IntentDraft {
  return {
    summary: a.summary ?? "",
    featureRequests: (a.featureRequests ?? []).map((f) => ({ ...f })),
    bugs: (a.bugs ?? []).map((b) => ({ ...b })),
    customerGoals: [...(a.customerGoals ?? [])],
    deadlines: (a.deadlines ?? []).map((d) => ({ ...d })),
    requestedIntegrations: [...(a.requestedIntegrations ?? [])],
    painPoints: (a.painPoints ?? []).map((p) => ({ ...p })),
  };
}

function IntentSection({ meetingId, analysis, locked, onSaved }: {
  meetingId: string; analysis: MeetingAnalysis; locked: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => cloneIntent(analysis));
  React.useEffect(() => { if (!editing) setDraft(cloneIntent(analysis)); }, [analysis, editing]);
  const set = <K extends keyof IntentDraft>(k: K, v: IntentDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.patchMeeting(meetingId, { analysis: { ...analysis, ...draft } });
      onSaved(); setEditing(false); toast.success("Customer intent updated");
    } catch { toast.error("Could not save"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={Crosshair} title="Customer Intent" hint="What the customer actually needs, extracted from the call."
      action={!locked && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>)}>
      {editing ? (
        <div className="space-y-4">
          <Field label="Summary"><Textarea value={draft.summary} onChange={(e) => set("summary", e.target.value)} rows={3} /></Field>
          <Field label="Feature requests">
            <ObjectList value={draft.featureRequests} onChange={(v) => set("featureRequests", v)} addLabel="Add request"
              blank={() => ({ id: `fr_${Date.now()}`, title: "", description: "", demand: 50, effort: "M" as const, category: "General" })}>
              {(f, setF) => (
                <div className="space-y-1.5">
                  <Input value={f.title} onChange={(e) => setF({ title: e.target.value })} placeholder="Request title" className="h-8 text-sm font-medium" />
                  <Input value={f.description} onChange={(e) => setF({ description: e.target.value })} placeholder="Description" className="h-8 text-sm" />
                </div>
              )}
            </ObjectList>
          </Field>
          <Field label="Bugs">
            <ObjectList value={draft.bugs} onChange={(v) => set("bugs", v)} addLabel="Add bug"
              blank={() => ({ id: `bug_${Date.now()}`, title: "", description: "", severity: "medium" as const })}>
              {(b, setB) => <Input value={b.title} onChange={(e) => setB({ title: e.target.value })} placeholder="Bug" className="h-8 text-sm" />}
            </ObjectList>
          </Field>
          <Field label="Goals"><StringList value={draft.customerGoals} onChange={(v) => set("customerGoals", v)} placeholder="Customer goal" addLabel="Add goal" /></Field>
          <Field label="Deadlines">
            <ObjectList value={draft.deadlines} onChange={(v) => set("deadlines", v)} addLabel="Add deadline"
              blank={() => ({ id: `dl_${Date.now()}`, title: "", due: "" })}>
              {(d, setD) => (
                <div className="flex gap-1.5">
                  <Input value={d.title} onChange={(e) => setD({ title: e.target.value })} placeholder="What's due" className="h-8 text-sm" />
                  <Input value={d.due} onChange={(e) => setD({ due: e.target.value })} placeholder="When" className="h-8 w-32 text-sm" />
                </div>
              )}
            </ObjectList>
          </Field>
          <Field label="Requested integrations"><StringList value={draft.requestedIntegrations} onChange={(v) => set("requestedIntegrations", v)} placeholder="e.g. Salesforce" addLabel="Add integration" /></Field>
          <Field label="Pain points">
            <ObjectList value={draft.painPoints} onChange={(v) => set("painPoints", v)} addLabel="Add pain point"
              blank={() => ({ id: `pp_${Date.now()}`, title: "", description: "", severity: "medium" as const, frequency: 1, quotes: [] })}>
              {(p, setP) => <Input value={p.title} onChange={(e) => setP({ title: e.target.value })} placeholder="Pain point" className="h-8 text-sm" />}
            </ObjectList>
          </Field>
        </div>
      ) : (
        <>
          {analysis.summary && <p className="text-sm text-muted-foreground">{analysis.summary}</p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {!!analysis.featureRequests?.length && <Field label="Feature requests"><Chips items={analysis.featureRequests.map((f) => f.title)} /></Field>}
            {!!analysis.bugs?.length && (
              <Field label="Bugs">
                <div className="space-y-1">
                  {analysis.bugs.map((b) => <div key={b.id} className="flex items-center gap-1.5 text-xs"><Bug className="h-3 w-3 text-destructive" /> {b.title}</div>)}
                </div>
              </Field>
            )}
            {!!analysis.customerGoals?.length && <Field label="Goals"><Chips items={analysis.customerGoals} /></Field>}
            {!!analysis.deadlines?.length && (
              <Field label="Deadlines">
                <div className="space-y-1">
                  {analysis.deadlines.map((d) => <div key={d.id} className="flex items-center gap-1.5 text-xs"><CalendarClock className="h-3 w-3 text-warning" /> {d.title} — <span className="font-medium">{d.due}</span></div>)}
                </div>
              </Field>
            )}
            {!!analysis.requestedIntegrations?.length && (
              <Field label="Requested integrations">
                <div className="flex flex-wrap gap-1.5">
                  {analysis.requestedIntegrations.map((it) => <span key={it} className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-0.5 text-xs"><Plug className="h-3 w-3" /> {it}</span>)}
                </div>
              </Field>
            )}
            {!!analysis.painPoints?.length && <Field label="Pain points"><Chips items={analysis.painPoints.map((p) => p.title)} /></Field>}
          </div>
        </>
      )}
    </Section>
  );
}

type TimelineDraft = {
  deliveryEstimate: string; durationWeeks: number; confidence: number;
  milestones: { title: string; week: number; description: string }[];
};

function cloneTimeline(tl: Project["timeline"]): TimelineDraft {
  return {
    deliveryEstimate: tl?.deliveryEstimate ?? "",
    durationWeeks: tl?.durationWeeks ?? 0,
    confidence: tl?.confidence ?? 0,
    milestones: (tl?.milestones ?? []).map((m) => ({ ...m })),
  };
}

function TimelineSection({ project, locked, onSaved }: { project: Project; locked: boolean; onSaved: () => void }) {
  const tl = project.timeline;
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => cloneTimeline(tl));
  React.useEffect(() => { if (!editing) setDraft(cloneTimeline(tl)); }, [tl, editing]);
  if (!tl) return null;
  const set = <K extends keyof TimelineDraft>(k: K, v: TimelineDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { timeline: { ...tl, ...draft } });
      onSaved(); setEditing(false); toast.success("Timeline updated");
    } catch { toast.error("Could not save timeline"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={CalendarClock} title="Timeline" hint={`${tl.deliveryEstimate} · ${tl.confidence}% confidence`}
      action={!locked && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>)}>
      {editing ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Delivery estimate"><Input value={draft.deliveryEstimate} onChange={(e) => set("deliveryEstimate", e.target.value)} /></Field>
            <Field label="Duration (weeks)"><Input type="number" min={0} value={draft.durationWeeks} onChange={(e) => set("durationWeeks", Number(e.target.value) || 0)} /></Field>
            <Field label="Confidence (%)"><Input type="number" min={0} max={100} value={draft.confidence} onChange={(e) => set("confidence", Number(e.target.value) || 0)} /></Field>
          </div>
          <Field label="Milestones">
            <ObjectList value={draft.milestones} onChange={(v) => set("milestones", v)} addLabel="Add milestone"
              blank={() => ({ title: "", week: draft.durationWeeks, description: "" })}>
              {(ms, setMs) => (
                <div className="flex gap-1.5">
                  <Input value={ms.title} onChange={(e) => setMs({ title: e.target.value })} placeholder="Milestone" className="h-8 text-sm" />
                  <Input type="number" min={0} value={ms.week} onChange={(e) => setMs({ week: Number(e.target.value) || 0 })} placeholder="Wk" className="h-8 w-20 text-sm" />
                </div>
              )}
            </ObjectList>
          </Field>
        </div>
      ) : (
        <>
          <TimelineBar timeline={tl} />
          {!!tl.criticalPath?.length && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground/70">Critical path:</span>
              <Chips items={tl.criticalPath} />
            </div>
          )}
        </>
      )}
    </Section>
  );
}
