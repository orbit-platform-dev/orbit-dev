"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Code2, FileText, PenTool, RefreshCw, ShieldCheck, Sparkles, Ticket, TrendingUp, Video } from "lucide-react";
import * as api from "@/lib/api";
import { qk, useMeeting, useProject } from "@/lib/hooks";
import { formatDate, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { SentimentBadge, UrgencyBadge } from "@/components/shared/status";
import { AgentIcon } from "@/components/shared/agent-icon";
import { sourceMeta } from "@/components/meetings/meeting-source";
import { TranscriptViewer } from "@/components/meetings/transcript-viewer";
import {
  ActionItemsList,
  AnalysisSummary,
  FeatureRequestsList,
  PainPointsList,
} from "@/components/meetings/meeting-analysis";
import {
  DesignTab,
  EngineeringTab,
  NotGenerated,
  PRDTab,
  QATab,
  SalesTab,
} from "@/components/projects/project-tabs";
import { TicketsPanel } from "@/components/tickets/tickets-panel";

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: m, isLoading } = useMeeting(id);
  const { data: project } = useProject(m?.linkedProjectId ?? "");
  const qc = useQueryClient();
  const retry = async () => {
    try {
      await api.analyzeMeeting(id);
      qc.invalidateQueries({ queryKey: qk.meeting(id) });
      toast.success("Re-analyzing this call…");
    } catch { toast.error("Couldn't restart analysis"); }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-8" />
          <Skeleton className="h-96 lg:col-span-4" />
        </div>
      </div>
    );
  }

  if (!m) {
    return (
      <EmptyState
        icon={Video}
        title="Signal not found"
        description="This signal may have been removed."
        action={<Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>}
      />
    );
  }

  const src = sourceMeta[m.source];
  const SrcIcon = src.icon;
  const processing = m.status !== "analyzed" && m.status !== "failed";
  const failed = m.status === "failed";
  const hasBreakdown = !!project;

  return (
    <div>
      <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border"
            style={{ background: `${src.color}1a`, borderColor: `${src.color}33`, color: src.color }}
          >
            <SrcIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground/80">{m.account}</span>
              <span>·</span>
              <span>{src.label}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDuration(m.durationSec)}</span>
              <span>·</span>
              <span>{formatDate(m.date, { month: "long", day: "numeric", year: "numeric" })}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.tags.map((t) => (
                <Badge key={t} variant="muted" className="capitalize">{t}</Badge>
              ))}
            </div>
          </div>
        </div>
        {m.linkedProjectId && (
          <div className="flex shrink-0 gap-2">
            <Button asChild className="gap-2">
              <Link href={`/signals/${m.id}/review`}>
                {project?.approvalStatus === "approved" ? (
                  <><CheckCircle2 className="h-4 w-4" /> View proposal</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Review &amp; approve</>
                )}
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Processing banner */}
      {processing && (
        <Card className="mb-6 border-info/30 bg-info/5 p-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 animate-pulse text-info" />
            <div className="flex-1">
              <div className="text-sm font-medium">
                {m.status === "transcribing" ? "Transcribing recording…" : "Agents are analyzing this call…"}
              </div>
              <div className="text-xs text-muted-foreground">The analysis, PRD, work items and follow-up will appear here shortly.</div>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">{m.analysisProgress}%</span>
          </div>
          <Progress value={m.analysisProgress} className="mt-3" indicatorClassName="bg-info" />
        </Card>
      )}

      {/* Failed banner */}
      {failed && (
        <Card className="mb-6 border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div className="flex-1">
              <div className="text-sm font-medium">Analysis didn&apos;t finish</div>
              <div className="text-xs text-muted-foreground">Something interrupted the agents before they were done. You can run it again.</div>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={retry}><RefreshCw className="h-4 w-4" /> Retry</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Main */}
        <div className="lg:col-span-8">
          <Tabs defaultValue={m.analysis ? "analysis" : "transcript"}>
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="analysis" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Analysis</TabsTrigger>
              {hasBreakdown && <TabsTrigger value="prd" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> PRD</TabsTrigger>}
              {hasBreakdown && <TabsTrigger value="engineering" className="gap-1.5"><Code2 className="h-3.5 w-3.5" /> Engineering</TabsTrigger>}
              {hasBreakdown && <TabsTrigger value="design" className="gap-1.5"><PenTool className="h-3.5 w-3.5" /> Design</TabsTrigger>}
              {hasBreakdown && <TabsTrigger value="qa" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> QA</TabsTrigger>}
              {hasBreakdown && <TabsTrigger value="sales" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Sales</TabsTrigger>}
              {hasBreakdown && <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="h-3.5 w-3.5" /> Tickets</TabsTrigger>}
              <TabsTrigger value="transcript" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Transcript</TabsTrigger>
            </TabsList>

            <TabsContent value="analysis">
              {m.analysis ? (
                <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }} className="space-y-4">
                  {[
                    <AnalysisSummary key="s" analysis={m.analysis} />,
                    <PainPointsList key="p" items={m.analysis.painPoints} />,
                    <FeatureRequestsList key="f" items={m.analysis.featureRequests} />,
                    <ActionItemsList key="a" items={m.analysis.actionItems} />,
                  ].map((node, i) => (
                    <motion.div key={i} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>{node}</motion.div>
                  ))}
                </motion.div>
              ) : (
                <EmptyState icon={Sparkles} title="Analysis in progress" description="Your agents are still working on this signal. Check back in a moment." />
              )}
            </TabsContent>

            {hasBreakdown && project && (
              <>
                <TabsContent value="prd">{project.prd ? <PRDTab prd={project.prd} /> : <NotGenerated tab="PRD" agent="product-manager" />}</TabsContent>
                <TabsContent value="engineering">{project.engineering ? <EngineeringTab plan={project.engineering} /> : <NotGenerated tab="Engineering" agent="engineering-planner" />}</TabsContent>
                <TabsContent value="design">{project.design ? <DesignTab plan={project.design} /> : <NotGenerated tab="Design" agent="design-planner" />}</TabsContent>
                <TabsContent value="qa">{project.qa ? <QATab plan={project.qa} /> : <NotGenerated tab="QA" agent="qa-planner" />}</TabsContent>
                <TabsContent value="sales">{project.sales ? <SalesTab plan={project.sales} /> : <NotGenerated tab="Sales" agent="sales-planner" />}</TabsContent>
                <TabsContent value="tickets">
                  <Card className="p-5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Ticket className="h-4 w-4 text-primary" /> Tickets from this signal</h3>
                    <TicketsPanel scope={{ projectId: project.id }} />
                  </Card>
                </TabsContent>
              </>
            )}

            <TabsContent value="transcript">
              <Card className="p-4">
                {m.transcript.length > 0 ? (
                  <TranscriptViewer segments={m.transcript} />
                ) : (
                  <EmptyState icon={FileText} title="Transcript not ready" description="The recording is still being transcribed." />
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right rail */}
        <div className="space-y-4 lg:col-span-4">
          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <AgentIcon agent="meeting-intelligence" size="sm" /> Signal intelligence
            </h3>
            {m.analysis ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="text-xs text-muted-foreground">Urgency</div>
                  <div className="mt-1"><UrgencyBadge urgency={m.analysis.urgency} /></div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="text-xs text-muted-foreground">Sentiment</div>
                  <div className="mt-1"><SentimentBadge sentiment={m.analysis.sentiment.overall} /></div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Pending analysis.</p>
            )}
          </Card>

          {/* Stakeholders */}
          {m.participants.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Stakeholders</h3>
              <div className="space-y-3">
                {m.participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <UserAvatar name={p.name} className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{p.role} · {p.company}</div>
                    </div>
                    <SentimentBadge sentiment={p.sentiment} />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
