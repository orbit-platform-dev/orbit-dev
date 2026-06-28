"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plug, Search } from "lucide-react";
import { toast } from "sonner";
import type { Integration, IntegrationStatus } from "@/lib/types";
import { useIntegrations } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { IntegrationCard } from "@/components/integrations/integration-card";

type Category = Integration["category"];
const CATEGORIES: Category[] = ["Conferencing", "Communication", "Engineering", "Product", "CRM", "Calendar"];

export default function IntegrationsPage() {
  const { data, isLoading } = useIntegrations();

  // Local, mutable state seeded from the hook data.
  const [items, setItems] = useState<Integration[]>([]);
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (data) setItems(data);
  }, [data]);

  const setStatus = (key: Integration["key"], status: IntegrationStatus, lastSync?: string) => {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, status, ...(lastSync !== undefined ? { lastSync } : {}) } : i)),
    );
  };

  const counts = useMemo(() => {
    const connected = items.filter((i) => i.status === "connected" || i.status === "syncing").length;
    const attention = items.filter((i) => i.status === "error").length;
    const available = items.filter((i) => i.status === "disconnected").length;
    return { connected, available, attention };
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
          <SummaryChip
            className={cn(
              "border-destructive/30 bg-destructive/10 text-destructive",
              counts.attention === 0 && "border-border bg-muted/40 text-muted-foreground",
            )}
            value={counts.attention}
            label="need attention"
          />
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
              onConnect={() => {
                setStatus(i.key, "connected", new Date().toISOString());
                toast.success(`${i.name} connected`);
              }}
              onDisconnect={() => {
                setStatus(i.key, "disconnected");
                toast(`${i.name} disconnected`);
              }}
              onReconnect={() => {
                setStatus(i.key, "connected", new Date().toISOString());
                toast.success(`${i.name} reconnected`);
              }}
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
