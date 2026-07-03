"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plug, Search } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { Integration, IntegrationStatus } from "@/lib/types";
import { qk, useIntegrations } from "@/lib/hooks";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { IntegrationCard } from "@/components/integrations/integration-card";

type Category = Integration["category"];
const CATEGORIES: Category[] = ["Engineering", "Conferencing", "Communication", "Product", "CRM", "Calendar", "Support"];

// Connectable destinations: issue trackers (Jira / Linear) + PRD doc tools
// (Google Docs / Notion / Confluence / Linear / Jira) + Google Calendar (real
// OAuth — powers Orbit call links on invites); everything else is "coming soon".
const CONNECTABLE = new Set(["jira", "linear", "google-docs", "confluence", "notion", "calendar"]);
const normalizeStatus = (i: Integration): Integration =>
  CONNECTABLE.has(i.key)
    ? { ...i, status: i.status === "connected" || i.status === "syncing" ? "connected" : "disconnected" }
    : { ...i, status: "coming-soon" };

export default function IntegrationsPage() {
  const { data, isLoading } = useIntegrations();
  const qc = useQueryClient();

  // Local, mutable state seeded from the hook data.
  const [items, setItems] = useState<Integration[]>([]);
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (data) setItems(data.map(normalizeStatus));
  }, [data]);

  // Landing back from Google's consent screen (?calendar=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    if (result === "connected") toast.success("Google Calendar connected", { description: "Upcoming calls now show on the Meetings page." });
    else toast.error("Google Calendar connection failed", { description: params.get("reason") ?? undefined });
    window.history.replaceState(null, "", "/integrations");
    qc.invalidateQueries({ queryKey: qk.integrations });
    qc.invalidateQueries({ queryKey: qk.calendarStatus });
  }, [qc]);

  const setStatus = (key: Integration["key"], status: IntegrationStatus, lastSync?: string) => {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, status, ...(lastSync !== undefined ? { lastSync } : {}) } : i)),
    );
  };

  // Persist connect/disconnect; optimistic + refetch. Google Calendar is a real
  // OAuth flow — the browser leaves for Google's consent screen and comes back.
  const connect = async (i: Integration) => {
    if (i.key === "calendar") {
      try {
        const { url } = await api.getCalendarAuthUrl();
        window.location.href = url;
      } catch (err) {
        toast.error("Google Calendar isn't configured", { description: (err as Error).message });
      }
      return;
    }
    setStatus(i.key, "connected", new Date().toISOString());
    try { await api.patchIntegration(i.key, "connected"); toast.success(`${i.name} connected`); }
    catch { setStatus(i.key, "disconnected"); toast.error(`Couldn't connect ${i.name}`); }
    qc.invalidateQueries({ queryKey: qk.integrations });
  };
  const disconnect = async (i: Integration) => {
    setStatus(i.key, "disconnected");
    try {
      if (i.key === "calendar") await api.disconnectCalendar();
      else await api.patchIntegration(i.key, "disconnected");
      toast(`${i.name} disconnected`);
    } catch { toast.error(`Couldn't disconnect ${i.name}`); }
    qc.invalidateQueries({ queryKey: qk.integrations });
    qc.invalidateQueries({ queryKey: qk.calendarStatus });
  };

  const counts = useMemo(() => {
    const connected = items.filter((i) => i.status === "connected" || i.status === "syncing").length;
    const available = items.filter((i) => i.status === "disconnected").length;
    const comingSoon = items.filter((i) => i.status === "coming-soon").length;
    return { connected, available, comingSoon };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [items, category, query]);

  const chips: { key: Category | "all"; label: string }[] = [
    { key: "all", label: "All" },
    ...CATEGORIES.map((c) => ({ key: c, label: c })),
  ];

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect Orbit to your meetings, comms, engineering and CRM stack so your agents can ingest and act everywhere your team works."
      >
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <SummaryChip className="border-success/30 bg-success/10 text-success" value={counts.connected} label="connected" />
          <SummaryChip className="border-border bg-muted/40 text-muted-foreground" value={counts.available} label="available" />
          <SummaryChip className="border-border bg-muted/40 text-muted-foreground" value={counts.comingSoon} label="coming soon" />
        </div>
      </PageHeader>

      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar">
          {chips.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations…"
            className="pl-9"
            aria-label="Search integrations"
          />
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[208px]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No integrations found"
          description="Try a different category or clear your search to see everything you can connect."
        />
      ) : (
        <motion.div
          key={`${category}-${query}`}
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map((i) => (
            <IntegrationCard
              key={i.key}
              integration={i}
              onConnect={() => connect(i)}
              onDisconnect={() => disconnect(i)}
              onReconnect={() => connect(i)}
              onConfigure={() => toast(`${i.name} settings`, { description: "Configuration is coming to this demo." })}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function SummaryChip({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium", className)}>
      <span className="tabular-nums">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  );
}
