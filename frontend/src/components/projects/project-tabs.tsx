"use client";

import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleDot,
  Code2,
  FileText,
  Sparkles,
  Target,
  Workflow,
  XCircle,
} from "lucide-react";
import type {
  AgentKey,
  DesignPlan,
  EngineeringPlan,
  Project,
  ProjectPRD,
  QAPlan,
  SalesPlan,
} from "@/lib/types";
import { cn, formatCurrency, formatDate, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { AgentIcon } from "@/components/shared/agent-icon";
import { UrgencyBadge } from "@/components/shared/status";
import { TicketsPanel } from "@/components/tickets/tickets-panel";

// --- shared bits ------------------------------------------------------------
function Panel({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          <h3 className="font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

const workStatusDot: Record<string, string> = { done: "bg-success", "in-progress": "bg-info", todo: "bg-muted-foreground" };

function GeneratedBy({ agent, at }: { agent: AgentKey; at: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AgentIcon agent={agent} size="sm" className="!h-5 !w-5 rounded" />
      Generated {timeAgo(at)}
    </div>
  );
}

export function NotGenerated({ tab, agent }: { tab: string; agent: AgentKey }) {
  return (
    <EmptyState
      icon={Sparkles}
      title={`No ${tab} yet`}
      description={`This project hasn't generated a ${tab.toLowerCase()} yet. Dispatch the agent to create one from the latest signals.`}
      action={
        <Button className="gap-2" onClick={() => toast.success(`Agent dispatched`, { description: `Generating ${tab.toLowerCase()}…` })}>
          <AgentIcon agent={agent} size="sm" className="!h-4 !w-4 rounded border-0 bg-transparent" />
          Generate {tab}
        </Button>
      }
    />
  );
}

// --- Overview ---------------------------------------------------------------
export function OverviewTab({ project: p }: { project: Project }) {
  const facts = [
    { label: "Status", value: <span className="capitalize">{p.status.replace("-", " ")}</span> },
    { label: "Target date", value: formatDate(p.targetDate) },
    { label: "Delivery estimate", value: p.deliveryEstimate },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel title="About" icon={<Target className="h-4 w-4" />}>
          <p className="text-sm leading-relaxed text-foreground/85">{p.description}</p>
          {p.prd?.problem && (
            <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problem</div>
              <p className="text-sm text-foreground/85">{p.prd.problem}</p>
            </div>
          )}
        </Panel>

        <Panel title="Progress by discipline" icon={<Workflow className="h-4 w-4" />}>
          <div className="space-y-3">
            {[
              { label: "Engineering", value: p.engineering ? 60 : 0, has: !!p.engineering },
              { label: "Design", value: p.design ? 55 : 0, has: !!p.design },
              { label: "QA", value: p.qa?.coverage ?? 0, has: !!p.qa },
              { label: "Sales enablement", value: p.sales ? 70 : 0, has: !!p.sales },
            ].map((d) => (
              <div key={d.label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="tabular-nums">{d.has ? `${d.value}%` : "Not started"}</span>
                </div>
                <Progress value={d.value} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Key facts">
          <div className="space-y-2.5">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="font-medium">{f.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Team">
          <div className="space-y-2.5">
            {p.team.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5">
                <UserAvatar name={m.name} className="h-7 w-7" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.title}</div>
                </div>
                {m.id === p.owner.id && <Badge variant="muted" className="ml-auto">Owner</Badge>}
              </div>
            ))}
          </div>
        </Panel>

        {p.sourceMeetingId && (
          <Button asChild variant="outline" className="w-full justify-start gap-2">
            <Link href={`/meetings/${p.sourceMeetingId}`}>
              <ArrowUpRight className="h-4 w-4" /> View source meeting
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" className="w-full justify-start gap-2">
          <Link href="/graph"><Workflow className="h-4 w-4" /> Open in Execution Graph</Link>
        </Button>
      </div>
    </div>
  );
}

// --- PRD --------------------------------------------------------------------
export function PRDTab({ prd }: { prd: ProjectPRD }) {
  const prioVariant = { P0: "destructive", P1: "warning", P2: "muted" } as const;
  return (
    <div className="space-y-4">
      <Panel title="Problem & goals" icon={<FileText className="h-4 w-4" />} action={<GeneratedBy agent={prd.generatedBy} at={prd.updatedAt} />}>
        <p className="text-sm leading-relaxed text-foreground/85">{prd.problem}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Goals</div>
            <ul className="space-y-1.5">
              {prd.goals.map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />{g}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Non-goals</div>
            <ul className="space-y-1.5">
              {prd.nonGoals.map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{g}</li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="Success metrics" icon={<Target className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-3">
          {prd.successMetrics.map((m, i) => (
            <div key={i} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-sm font-medium">{m.metric}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-primary">{m.target}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="User stories">
        <div className="space-y-2">
          {prd.userStories.map((s) => (
            <div key={s.id} className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
              <Badge variant={prioVariant[s.priority]}>{s.priority}</Badge>
              <div>
                <div className="text-xs text-muted-foreground">As a {s.persona}</div>
                <div className="text-sm">{s.story}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {prd.sections.length > 0 && (
        <Panel title="Detail">
          <div className="space-y-3">
            {prd.sections.map((s, i) => (
              <div key={i}>
                <div className="text-sm font-medium">{s.heading}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// --- Engineering ------------------------------------------------------------
export function EngineeringTab({ plan }: { plan: EngineeringPlan }) {
  return (
    <div className="space-y-4">
      <Panel
        title="Architecture"
        icon={<Code2 className="h-4 w-4" />}
        action={<Badge variant="muted">{plan.estimateWeeks} week estimate</Badge>}
      >
        <p className="text-sm leading-relaxed text-foreground/85">{plan.architecture}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.techStack.map((t) => (
            <span key={t} className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 font-mono text-xs">{t}</span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Components">
          <div className="space-y-2">
            {plan.components.map((c, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-background/40 p-2.5">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", workStatusDot[c.status])} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.description}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="API surface">
          <div className="space-y-1.5">
            {plan.apis.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-background/40 p-2 font-mono text-xs">
                <span className={cn("rounded px-1.5 py-0.5 font-semibold",
                  a.method === "GET" ? "bg-info/15 text-info" : a.method === "POST" ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                  {a.method}
                </span>
                <span className="truncate">{a.path}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Risks" icon={<AlertTriangle className="h-4 w-4 text-warning" />}>
        <div className="space-y-2">
          {plan.risks.map((r, i) => (
            <div key={i} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{r.risk}</div>
                <UrgencyBadge urgency={r.severity} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground"><span className="font-medium">Mitigation:</span> {r.mitigation}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// --- Design -----------------------------------------------------------------
export function DesignTab({ plan }: { plan: DesignPlan }) {
  return (
    <div className="space-y-4">
      <Panel title="Design summary">
        <p className="text-sm leading-relaxed text-foreground/85">{plan.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.principles.map((p) => (
            <Badge key={p} variant="outline">{p}</Badge>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="User flows">
          <div className="space-y-3">
            {plan.flows.map((f, i) => (
              <div key={i}>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {f.steps.map((s, j) => (
                    <span key={j} className="flex items-center gap-1">
                      <span className="rounded bg-secondary/60 px-1.5 py-0.5">{s}</span>
                      {j < f.steps.length - 1 && <span>→</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Screens">
          <div className="space-y-2">
            {plan.screens.map((s, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-background/40 p-2.5">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", workStatusDot[s.status])} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.description}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// --- QA ---------------------------------------------------------------------
export function QATab({ plan }: { plan: QAPlan }) {
  const tcIcon = (s: string) =>
    s === "pass" ? <CheckCircle2 className="h-4 w-4 text-success" /> : s === "fail" ? <XCircle className="h-4 w-4 text-destructive" /> : <Circle className="h-4 w-4 text-muted-foreground" />;
  return (
    <div className="space-y-4">
      <Panel title="Test strategy" action={<Badge variant={plan.coverage > 70 ? "success" : "warning"}>{plan.coverage}% coverage</Badge>}>
        <p className="text-sm leading-relaxed text-foreground/85">{plan.strategy}</p>
        <Progress value={plan.coverage} className="mt-3" indicatorClassName={plan.coverage > 70 ? "bg-success" : "bg-warning"} />
      </Panel>
      <Panel title="Test cases">
        <div className="space-y-1.5">
          {plan.testCases.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-2.5">
              {tcIcon(t.status)}
              <span className="flex-1 text-sm">{t.title}</span>
              <Badge variant="outline" className="uppercase">{t.type}</Badge>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Open risks" icon={<AlertTriangle className="h-4 w-4 text-warning" />}>
        <ul className="space-y-1.5">
          {plan.risks.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm"><CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />{r}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// --- Sales ------------------------------------------------------------------
export function SalesTab({ plan }: { plan: SalesPlan }) {
  return (
    <div className="space-y-4">
      <Panel title="Positioning">
        <p className="text-sm leading-relaxed text-foreground/85">{plan.positioning}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.targetSegments.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Talking points">
          <ul className="space-y-1.5">
            {plan.talkingPoints.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />{t}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Pricing">
          <div className="space-y-2">
            {plan.pricing.map((p, i) => (
              <div key={i} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.tier}</span>
                  <span className="font-semibold text-primary">{p.price}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{p.features.join(" · ")}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Pipeline" action={<Badge variant="success">{formatCurrency(plan.pipeline.reduce((s, x) => s + x.value, 0))}</Badge>}>
        <div className="space-y-1.5">
          {plan.pipeline.map((d, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border bg-background/40 p-2.5">
              <div>
                <div className="text-sm font-medium">{d.account}</div>
                <div className="text-xs text-muted-foreground">{d.stage}</div>
              </div>
              <span className="text-sm font-semibold tabular-nums">{formatCurrency(d.value)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// --- Documents --------------------------------------------------------------
export function DocumentsTab({ project: p }: { project: Project }) {
  if (p.documents.length === 0) {
    return <EmptyState icon={FileText} title="No documents yet" description="Documents generated by agents will appear here." />;
  }
  return (
    <Card className="divide-y divide-border p-0">
      {p.documents.map((d) => (
        <div key={d.id} className="flex items-center gap-3 p-4 transition-colors hover:bg-accent/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/40">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{d.title}</div>
            <div className="text-xs text-muted-foreground">{d.wordCount.toLocaleString()} words · updated {timeAgo(d.createdAt)}</div>
          </div>
          <Badge variant="outline">{d.type}</Badge>
          <Button variant="ghost" size="icon-sm"><ArrowUpRight className="h-4 w-4" /></Button>
        </div>
      ))}
    </Card>
  );
}

// --- Plan (Engineering + Design + QA + Sales, merged) -----------------------
export function PlanTab({ project: p }: { project: Project }) {
  const sections = [
    { key: "engineering", label: "Engineering", node: p.engineering ? <EngineeringTab plan={p.engineering} /> : null },
    { key: "design", label: "Design", node: p.design ? <DesignTab plan={p.design} /> : null },
    { key: "qa", label: "QA", node: p.qa ? <QATab plan={p.qa} /> : null },
    { key: "sales", label: "Sales", node: p.sales ? <SalesTab plan={p.sales} /> : null },
  ].filter((s) => s.node);

  if (sections.length === 0) {
    return <NotGenerated tab="Plan" agent="engineering-planner" />;
  }

  return (
    <Tabs defaultValue={sections[0].key}>
      <TabsList>
        {sections.map((s) => (
          <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>
        ))}
      </TabsList>
      {sections.map((s) => (
        <TabsContent key={s.key} value={s.key}>{s.node}</TabsContent>
      ))}
    </Tabs>
  );
}

// --- Tickets (Jira / Linear) ------------------------------------------------
export function TicketsTab({ project: p }: { project: Project }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Code2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Tickets</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Work the agents broke down for this project, synced to your issue tracker. Turn on auto-create to push new tickets automatically.
      </p>
      <TicketsPanel scope={{ projectId: p.id }} />
    </Card>
  );
}
