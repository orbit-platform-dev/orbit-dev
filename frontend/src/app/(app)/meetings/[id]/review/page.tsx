"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowUpRight, Bug, CalendarClock, CheckCircle2, Crosshair, FileText,
  ListChecks, Lock, Mail, Pencil, Plug, Rocket, Sparkles, Workflow,
} from "lucide-react";
import { qk, useConnectedProvider, useMeeting, useProject, useTasks } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { MeetingAnalysis, Project, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import { WorkItemCard, type Provider } from "@/components/execution/work-item-card";
import { ObjectList, StringList } from "@/components/execution/editable";
import { PrdPublish } from "@/components/execution/prd-publish";
import { PublishDialog } from "@/components/execution/publish-dialog";
import { downloadPlanPdf } from "@/components/execution/plan-pdf";
import { PUBLISH_DESTINATIONS, type PrdDestination, type PublishOutcome } from "@/components/execution/publish-destinations";

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
      {a && <IntentSection meetingId={id} analysis={a} locked={approved} onSaved={invalidate} />}

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
                    {items.map((t) => (
                      <WorkItemCard key={t.id} task={t} members={members} connectedProvider={connectedProvider} canPush={approved} canEdit={!approved} onChanged={invalidate} />
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
          <div className="flex items-center gap-2">
            {approved && <PushPlanDialog tasks={tasks} projectName={project.name} onPushed={invalidate} />}
            <Button onClick={approve} disabled={approved || approving} className="gap-2">
              {approved ? <><Lock className="h-4 w-4" /> Approved</> : <><Rocket className="h-4 w-4" /> {approving ? "Approving…" : "Approve execution plan"}</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PushPlanDialog({ tasks, projectName, onPushed }: { tasks: Task[]; projectName: string; onPushed: () => void }) {
  // Accepted, not-yet-pushed items are eligible to push; the PDF covers all accepted items.
  const pending = tasks.filter((t) => t.links?.decision !== "declined" && !t.links?.pushed);
  const planItems = tasks.filter((t) => t.links?.decision !== "declined");

  const publish = async (dest: PrdDestination): Promise<PublishOutcome> => {
    if (dest.integrationKey === null) {
      await downloadPlanPdf(planItems, projectName); // PDF
      return { key: dest.key, name: dest.name };
    }
    if (dest.integrationKey === "jira" || dest.integrationKey === "linear") {
      for (const t of pending) await api.pushTask(t.id, dest.integrationKey); // create issues
      return { key: dest.key, name: dest.name, url: api.stubBoardUrl(dest.integrationKey) };
    }
    // Doc tools: publish the plan as a document (stub link until the integration exists).
    return { key: dest.key, name: dest.name, url: api.stubDocUrl(dest.integrationKey) };
  };

  return (
    <PublishDialog
      trigger={<Button variant="outline" className="gap-2"><ArrowUpRight className="h-4 w-4" /> Push to tools</Button>}
      title="Where should these work items go?"
      description={`${pending.length} work item${pending.length === 1 ? "" : "s"} ready · declined and already-pushed items are skipped.`}
      destinations={PUBLISH_DESTINATIONS}
      publish={publish}
      onDone={onPushed}
    />
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
  const [draft, setDraft] = React.useState(() => clonePrd(prd, project.name));
  React.useEffect(() => { if (!editing) setDraft(clonePrd(prd, project.name)); }, [prd, project.name, editing]);
  if (!prd) return null;
  const set = <K extends keyof PrdDraft>(k: K, v: PrdDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { prd: { ...prd, ...draft } });
      onSaved(); setEditing(false); toast.success("PRD updated");
    } catch { toast.error("Could not save PRD"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={FileText} title="Draft PRD" hint="Editable — Orbit's first draft."
      action={editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <div className="flex items-center gap-1.5">
            <PrdPublish projectId={project.id} prd={prd} projectName={project.name} onChanged={onSaved} />
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

function EmailSection({ project, locked, onSaved }: { project: Project; locked: boolean; onSaved: () => void }) {
  const cu = project.customerUpdate;
  const skipped = cu?.skipped;
  const [editing, setEditing] = React.useState(false);
  const [subject, setSubject] = React.useState(cu?.subject ?? "");
  const [body, setBody] = React.useState(cu?.body ?? "");
  const [commitments, setCommitments] = React.useState<string[]>(cu?.commitments ?? []);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!editing) {
      setSubject(cu?.subject ?? ""); setBody(cu?.body ?? ""); setCommitments(cu?.commitments ?? []);
    }
  }, [cu, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patchProject(project.id, { customerUpdate: { ...cu, subject, body, commitments } });
      onSaved(); setEditing(false); toast.success("Follow-up updated");
    } catch { toast.error("Could not save email"); }
    finally { setBusy(false); }
  };

  return (
    <Section icon={Mail} title="Customer Follow-up" hint="Editable draft — sending comes with integrations."
      action={!locked && !skipped && (editing
        ? <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>)}>
      {skipped ? (
        <p className="text-sm text-muted-foreground">Skipped — {cu?.reason || "no follow-up needed."}</p>
      ) : editing ? (
        <div className="space-y-3">
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} /></Field>
          <Field label="Commitments"><StringList value={commitments} onChange={setCommitments} placeholder="What we committed to" addLabel="Add commitment" /></Field>
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
