"use client";

import {
  CheckCircle2,
  Circle,
  CircleDot,
  Lightbulb,
  Quote,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type {
  ActionItem,
  BusinessOpportunity,
  FeatureRequest,
  MeetingAnalysis,
  PainPoint,
} from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { UrgencyBadge } from "@/components/shared/status";

function SectionCard({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="font-semibold">{title}</h3>
        {typeof count === "number" && <Badge variant="muted">{count}</Badge>}
      </div>
      {children}
    </Card>
  );
}

export function AnalysisSummary({ analysis }: { analysis: MeetingAnalysis }) {
  return (
    <SectionCard title="Summary" icon={<Sparkles className="h-4 w-4" />}>
      <p className="text-sm leading-relaxed text-foreground/85">{analysis.summary}</p>
      <div className="mt-4 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key takeaways</div>
        {analysis.keyTakeaways.map((t, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-foreground/85">{t}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function SentimentPanel({ analysis }: { analysis: MeetingAnalysis }) {
  const { sentiment, topics } = analysis;
  return (
    <SectionCard title="Sentiment & topics" icon={<TrendingUp className="h-4 w-4" />}>
      <div className="space-y-3">
        {sentiment.breakdown.map((b) => (
          <div key={b.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="tabular-nums">{Math.round(b.value * 100)}%</span>
            </div>
            <Progress
              value={b.value * 100}
              indicatorClassName={cn(b.value > 0.66 ? "bg-success" : b.value > 0.4 ? "bg-warning" : "bg-destructive")}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <span
            key={t.label}
            className="rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs"
            style={{ opacity: 0.5 + t.weight * 0.5 }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </SectionCard>
  );
}

export function PainPointsList({ items }: { items: PainPoint[] }) {
  return (
    <SectionCard title="Pain points" icon={<CircleDot className="h-4 w-4 text-destructive" />} count={items.length}>
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-medium">{p.title}</h4>
              <UrgencyBadge urgency={p.severity} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
            {p.quotes.map((q, i) => (
              <div key={i} className="mt-2 flex gap-2 rounded-md bg-secondary/40 p-2 text-xs italic text-foreground/70">
                <Quote className="h-3 w-3 shrink-0 text-muted-foreground" />
                {q}
              </div>
            ))}
            <div className="mt-2 text-[11px] text-muted-foreground">Referenced {p.frequency}× in this call</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function FeatureRequestsList({ items }: { items: FeatureRequest[] }) {
  return (
    <SectionCard title="Feature requests" icon={<Lightbulb className="h-4 w-4 text-warning" />} count={items.length}>
      <div className="space-y-3">
        {items.map((f) => (
          <div key={f.id} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-medium">{f.title}</h4>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline">{f.category}</Badge>
                <Badge variant="muted">{f.effort}</Badge>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex-1">
                <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>Demand</span>
                  <span className="tabular-nums">{f.demand}/100</span>
                </div>
                <Progress value={f.demand} className="h-1" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function OpportunitiesList({ items }: { items: BusinessOpportunity[] }) {
  const typeVariant = { expansion: "info", "new-logo": "default", retention: "success", upsell: "warning" } as const;
  return (
    <SectionCard title="Business opportunities" icon={<TrendingUp className="h-4 w-4 text-success" />} count={items.length}>
      <div className="space-y-3">
        {items.map((o) => (
          <div key={o.id} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-medium">{o.title}</h4>
                <Badge variant={typeVariant[o.type]} className="mt-1 capitalize">{o.type.replace("-", " ")}</Badge>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums text-success">{formatCurrency(o.revenueImpact)}</div>
                <div className="text-[11px] text-muted-foreground">{o.timeframe}</div>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{o.description}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Confidence</span>
              <Progress value={o.confidence} className="h-1 w-24" indicatorClassName="bg-success" />
              <span className="tabular-nums">{o.confidence}%</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function ActionItemsList({ items }: { items: ActionItem[] }) {
  const icon = (s: ActionItem["status"]) =>
    s === "done" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : s === "in-progress" ? (
      <CircleDot className="h-4 w-4 text-info" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground" />
    );
  return (
    <SectionCard title="Action items" icon={<CheckCircle2 className="h-4 w-4" />} count={items.length}>
      <div className="space-y-1">
        {items.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-accent/50">
            {icon(a.status)}
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm", a.status === "done" && "text-muted-foreground line-through")}>{a.title}</div>
              <div className="text-xs text-muted-foreground">
                {a.owner}
                {a.due ? <> · due {new Date(a.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</> : null}
              </div>
            </div>
            {a.linkedTaskId && <Badge variant="muted" className="shrink-0">Tracked</Badge>}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
