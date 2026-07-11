"use client";

// Honesty rule: only integrations with a real backend implementation are
// connectable (OAuth: Calendar / Zoom / Meet; API key: Linear). Everything
// else renders under "On the roadmap" — no flag-toggle fake connects.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Loader2, Plug, Search } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { Integration } from "@/lib/types";
import { qk, useIntegrations } from "@/lib/hooks";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { IntegrationCard } from "@/components/integrations/integration-card";

const LIVE = new Set(["calendar", "zoom", "google-meet", "linear"]);
const normalizeStatus = (i: Integration): Integration =>
  LIVE.has(i.key)
    ? { ...i, status: i.status === "connected" || i.status === "syncing" ? "connected" : "disconnected" }
    : { ...i, status: "coming-soon" };

export default function IntegrationsPage() {
  const { data, isLoading } = useIntegrations();
  const qc = useQueryClient();

  const [items, setItems] = useState<Integration[]>([]);
  const [query, setQuery] = useState("");
  const [linearOpen, setLinearOpen] = useState(false);

  useEffect(() => {
    if (data) setItems(data.map(normalizeStatus));
  }, [data]);

  // Landing back from an OAuth consent screen (?calendar=… / ?zoom=… / ?meet=…).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const results: [string, string][] = [["calendar", "Google Calendar"], ["zoom", "Zoom"], ["meet", "Google Meet"]];
    let handled = false;
    for (const [key, label] of results) {
      const result = params.get(key);
      if (!result) continue;
      handled = true;
      if (result === "connected") toast.success(`${label} connected`);
      else toast.error(`${label} connection failed`, { description: params.get("reason") ?? undefined });
    }
    if (!handled) return;
    window.history.replaceState(null, "", "/integrations");
    qc.invalidateQueries({ queryKey: qk.integrations });
    qc.invalidateQueries({ queryKey: qk.calendarStatus });
    qc.invalidateQueries({ queryKey: qk.zoomStatus });
    qc.invalidateQueries({ queryKey: qk.meetStatus });
  }, [qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.integrations });
    qc.invalidateQueries({ queryKey: qk.calendarStatus });
    qc.invalidateQueries({ queryKey: qk.zoomStatus });
    qc.invalidateQueries({ queryKey: qk.meetStatus });
  };

  const OAUTH_AUTH_URL: Partial<Record<Integration["key"], () => Promise<{ url: string }>>> = {
    calendar: api.getCalendarAuthUrl,
    zoom: api.getZoomAuthUrl,
    "google-meet": api.getMeetAuthUrl,
  };
  const OAUTH_DISCONNECT: Partial<Record<Integration["key"], () => Promise<unknown>>> = {
    calendar: api.disconnectCalendar,
    zoom: api.disconnectZoom,
    "google-meet": api.disconnectMeet,
    linear: api.disconnectLinear,
  };

  const connect = async (i: Integration) => {
    if (i.key === "linear") {
      setLinearOpen(true);
      return;
    }
    const authUrl = OAUTH_AUTH_URL[i.key];
    if (!authUrl) return;
    try {
      const { url } = await authUrl();
      window.location.href = url;
    } catch (err) {
      toast.error(`${i.name} isn't configured`, { description: (err as Error).message });
    }
  };

  const disconnect = async (i: Integration) => {
    setItems((prev) => prev.map((x) => (x.key === i.key ? { ...x, status: "disconnected" } : x)));
    try {
      await OAUTH_DISCONNECT[i.key]?.();
      toast(`${i.name} disconnected`);
    } catch {
      toast.error(`Couldn't disconnect ${i.name}`);
    }
    refresh();
  };

  const q = query.trim().toLowerCase();
  const matches = (i: Integration) =>
    !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.category.toLowerCase().includes(q);

  const live = useMemo(() => items.filter((i) => LIVE.has(i.key)).filter(matches), [items, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const roadmap = useMemo(() => items.filter((i) => !LIVE.has(i.key)).filter(matches), [items, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const connectedCount = items.filter((i) => i.status === "connected" || i.status === "syncing").length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Orbit reads signals from your tools and writes back only what you approve. Your tools stay the system of record."
      >
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <SummaryChip className="border-success/30 bg-success/10 text-success" value={connectedCount} label="connected" />
          <SummaryChip className="border-border bg-muted/40 text-muted-foreground" value={live.length} label="live" />
          <SummaryChip className="border-border bg-muted/40 text-muted-foreground" value={roadmap.length} label="on the roadmap" />
        </div>
      </PageHeader>

      <div className="mb-5 flex justify-end">
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

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[208px]" />
          ))}
        </div>
      ) : live.length === 0 && roadmap.length === 0 ? (
        <EmptyState icon={Plug} title="No integrations found" description="Clear your search to see everything." />
      ) : (
        <div className="space-y-8">
          {live.length > 0 && (
            <IntegrationSection
              title="Works today"
              hint="Real connections — data actually flows."
              items={live}
              onConnect={connect}
              onDisconnect={disconnect}
            />
          )}
          {roadmap.length > 0 && (
            <IntegrationSection
              title="On the roadmap"
              hint="Not built yet. Shown so you know where Orbit is heading — nothing here pretends to work."
              items={roadmap}
              onConnect={connect}
              onDisconnect={disconnect}
            />
          )}
        </div>
      )}

      <LinearConnectDialog open={linearOpen} onOpenChange={setLinearOpen} onConnected={refresh} />
    </div>
  );
}

function IntegrationSection({ title, hint, items, onConnect, onDisconnect }: {
  title: string; hint: string; items: Integration[];
  onConnect: (i: Integration) => void; onDisconnect: (i: Integration) => void;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {items.map((i) => (
          <IntegrationCard
            key={i.key}
            integration={i}
            onConnect={() => onConnect(i)}
            onDisconnect={() => onDisconnect(i)}
            onReconnect={() => onConnect(i)}
            onConfigure={() => toast(`${i.name}`, { description: "Connection is managed here; there's nothing else to configure yet." })}
          />
        ))}
      </motion.div>
    </section>
  );
}

function LinearConnectDialog({ open, onOpenChange, onConnected }: {
  open: boolean; onOpenChange: (v: boolean) => void; onConnected: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!apiKey.trim()) return;
    setBusy(true);
    try {
      const res = await api.connectLinear(apiKey.trim());
      toast.success(`Linear connected${res.account ? ` — ${res.account}` : ""}`);
      onConnected();
      onOpenChange(false);
      setApiKey("");
    } catch (err) {
      toast.error("Linear rejected the key", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setApiKey(""); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Linear</DialogTitle>
          <DialogDescription>
            Orbit validates the key against Linear and uses it only to create the issues you approve.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="linear-key">Personal API key</Label>
          <Input
            id="linear-key"
            type="password"
            placeholder="lin_api_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <p className="text-[11px] text-muted-foreground">
            Linear → Settings → API → Personal API keys. Stored on the backend, never shown again.
          </p>
        </div>
        <Button className="w-full gap-2" disabled={!apiKey.trim() || busy} onClick={submit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {busy ? "Validating…" : "Connect"}
        </Button>
      </DialogContent>
    </Dialog>
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
