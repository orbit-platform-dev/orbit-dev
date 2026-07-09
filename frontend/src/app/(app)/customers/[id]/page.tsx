"use client";

// One customer, structured like the product model: the customer contains their
// meetings, and inside that lives the approved Knowledge Base. Chat about this
// customer is one click away and carries their context.

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowUpRight, Building2, CalendarClock, CheckCircle2, Circle, Contact, FileText,
  Handshake, Mail, MessageCircle, Plus, Sparkles, Video,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useCustomer, useCustomerKnowledge, useMeetings } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { KnowledgeItem, KnowledgeKind } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const KIND_META: Record<KnowledgeKind, { label: string; icon: React.ElementType; color: string }> = {
  "meeting-summary": { label: "Meeting summary", icon: Video, color: "#6366f1" },
  "crm-update": { label: "CRM update", icon: Contact, color: "#f97316" },
  prd: { label: "PRD", icon: FileText, color: "#8b5cf6" },
  timeline: { label: "Timeline", icon: CalendarClock, color: "#22d3ee" },
  "follow-up-email": { label: "Follow-up email", icon: Mail, color: "#14b8a6" },
  commitment: { label: "Commitment", icon: Handshake, color: "#f59e0b" },
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, isLoading } = useCustomer(id);
  const { data: knowledge } = useCustomerKnowledge(id);
  const { data: allMeetings } = useMeetings();
  const meetings = React.useMemo(
    () => (allMeetings ?? []).filter((m) => m.customerId === id), [allMeetings, id]);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!c) return <EmptyState icon={Building2} title="Customer not found" description="This customer may have been removed." />;

  const commitments = (knowledge ?? []).filter((k) => k.kind === "commitment");
  const openCommitments = commitments.filter((k) => k.status === "open");
  const artifacts = (knowledge ?? []).filter((k) => k.kind !== "commitment");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* ── Customer ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-secondary text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <p className="text-xs text-muted-foreground">
              {c.domains.length ? c.domains.join(" · ") : "no email domain on record"}
              {c.aliases.length > 0 && <> · also known as {c.aliases.join(", ")}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link href={`/chat?customer=${c.id}`}><MessageCircle className="h-4 w-4" /> Ask about {c.name.split(" ")[0]}</Link>
          </Button>
          <Button asChild className="gap-2">
            <Link href="/meetings?upload=1"><Plus className="h-4 w-4" /> New meeting</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Meetings" value={c.meetingCount} />
        <Stat label="Plans approved" value={`${c.approvedPlanCount}/${c.planCount}`} />
        <Stat label="Open commitments" value={openCommitments.length} warn={openCommitments.length > 0} />
        <Stat label="Last meeting" value={c.lastMeetingAt ? timeAgo(c.lastMeetingAt) : "—"} />
      </div>

      {/* ── Open commitments — what we owe them ── */}
      {commitments.length > 0 && (
        <Card className="p-5">
          <SectionTitle icon={Handshake} title="Commitments" hint="What was promised to this customer — check off what's delivered." />
          <div className="mt-3 space-y-1.5">
            {commitments.map((k) => <CommitmentRow key={k.id} item={k} customerId={id} />)}
          </div>
        </Card>
      )}

      {/* ── Meetings ── */}
      <Card className="p-5">
        <SectionTitle icon={Video} title="Meetings" hint="Every conversation with this customer — each one became (or becomes) an execution plan." />
        {meetings.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No meetings yet — upload one and it will land here automatically.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {meetings.map((m, i) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Link href={`/meetings/${m.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:border-primary/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.title}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(m.date)} · {m.status}</div>
                  </div>
                  {m.linkedProjectId && <Badge variant="muted" className="gap-1"><Sparkles className="h-3 w-3" /> plan</Badge>}
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Knowledge Base — approved truth only ── */}
      <Card className="p-5">
        <SectionTitle icon={Sparkles} title="Knowledge Base"
          hint="Approved outcomes only — this is what the Context Engine feeds into every new proposal and chat answer." />
        {artifacts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Empty until a plan is approved — raw AI output never becomes knowledge.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {artifacts.map((k) => {
              const meta = KIND_META[k.kind];
              const Icon = meta.icon;
              return (
                <div key={k.id} className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                    style={{ background: `${meta.color}1a`, borderColor: `${meta.color}33`, color: meta.color }}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{k.title}</span>
                      <Badge variant="muted" className="text-[10px]">{meta.label}</Badge>
                    </div>
                    {typeof k.content.summary === "string" && k.content.summary && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{k.content.summary}</p>
                    )}
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                      approved {k.approvedAt ? timeAgo(k.approvedAt) : ""}
                      {k.sourceMeetingId && <> · <Link className="hover:text-primary" href={`/meetings/${k.sourceMeetingId}`}>source meeting</Link></>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className={`text-lg font-semibold tabular-nums ${warn ? "text-warning" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function CommitmentRow({ item: k, customerId }: { item: KnowledgeItem; customerId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const done = k.status === "completed";

  const toggle = async () => {
    setBusy(true);
    try {
      await api.patchKnowledge(k.id, done ? "open" : "completed");
      qc.invalidateQueries({ queryKey: qk.customerKnowledge(customerId) });
      qc.invalidateQueries({ queryKey: qk.customers });
      if (!done) toast.success("Commitment completed");
    } catch (err) { toast.error("Couldn't update", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <button onClick={toggle} disabled={busy}
      className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background/40 px-3 py-2 text-left transition-colors hover:border-primary/40">
      {done
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className={`flex-1 text-sm ${done ? "text-muted-foreground line-through" : ""}`}>{k.title}</span>
      <span className="text-[11px] text-muted-foreground/70">{k.approvedAt ? timeAgo(k.approvedAt) : ""}</span>
    </button>
  );
}
