"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { useIntegrations, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Integration } from "@/lib/types";

// Plainer, no-jargon category labels for the filter chips.
const CATEGORY_LABEL: Record<string, string> = {
  Engineering: "Engineering",
  Communication: "Communication",
  CRM: "CRM",
  Conferencing: "Calls",
  Product: "Docs",
};
const catLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

function LinearDialog({ open, onOpenChange, oauthAvailable, onOAuth }: { open: boolean; onOpenChange: (o: boolean) => void; oauthAvailable: boolean; onOAuth: () => void }) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const connect = useMutation({
    mutationFn: () => api.connectLinear(key.trim()),
    onSuccess: (i) => {
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success(`Linear connected${i.account ? ` · ${i.account}` : ""}`);
      onOpenChange(false);
      setKey("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not connect Linear"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect Linear</DialogTitle></DialogHeader>
        {oauthAvailable && (
          // Preferred path: one click, no secret to copy. Full browser redirect.
          <div className="space-y-3">
            <Button className="w-full" onClick={onOAuth}>
              <Plug className="h-4 w-4" /> Connect with Linear
            </Button>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or use an API key <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="linear-key">Personal API key</Label>
          <Input id="linear-key" placeholder="lin_api_…" value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Linear → Settings → Security &amp; access → Personal API keys. Validated live; stored server-side, never exposed.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending || !key.trim()}>
            {connect.isPending ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationRow({ integration, onConnect }: { integration: Integration; onConnect: (key: string) => void }) {
  const qc = useQueryClient();
  const connected = integration.status === "connected" || integration.status === "syncing";
  const isLinear = integration.key === "linear";
  // Connectable now = we have a connector AND a working path today (Linear has
  // the key fallback; OAuth-only providers need their OAuth configured).
  const canConnectNow = !!integration.connectable && (isLinear || !!integration.oauthAvailable);
  const disconnect = useMutation({
    mutationFn: () => api.disconnectIntegration(integration.key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success(`${integration.name} disconnected`);
    },
  });
  return (
    <Card className={cn("flex items-center gap-4 p-4", !canConnectNow && !connected && "opacity-80")}>
      <IntegrationLogo k={integration.key} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{integration.name}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {catLabel(integration.category)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{integration.description}</p>
      </div>
      {connected ? (
        <Button variant="outline" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
      ) : canConnectNow ? (
        <Button size="sm" onClick={() => onConnect(integration.key)}><Plug className="h-4 w-4" /> Connect</Button>
      ) : (
        <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">Coming soon</span>
      )}
    </Card>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const OAUTH_ERROR_MSG: Record<string, string> = {
  state: "Sign-in expired, please try again",
  exchange: "The provider rejected the sign-in, please try again",
};

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useIntegrations();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Handle the return from any provider's OAuth redirect (?connected=<key> / ?error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (connected) {
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success(`${cap(connected)} connected`);
    } else if (error) {
      toast.error(OAUTH_ERROR_MSG[error] ?? `${cap(error)} sign-in was cancelled or failed`);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [qc]);

  const linearOAuthAvailable = !!(data ?? []).find((i) => i.key === "linear")?.oauthAvailable;
  // Mint an authenticated, workspace-bound authorize URL, then redirect the browser.
  const startOAuth = async (key: string) => {
    try {
      const { url } = await api.getOAuthUrl(key);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not start ${cap(key)} sign-in`);
    }
  };
  // Linear opens the dialog (OAuth + key); OAuth-only providers go straight out.
  const onConnect = (key: string) => {
    if (key === "linear") setDialogOpen(true);
    else startOAuth(key);
  };

  const categories = useMemo(() => {
    const set = Array.from(new Set((data ?? []).map((i) => i.category)));
    return ["All", ...set];
  }, [data]);

  const filtered = (data ?? [])
    .filter((i) => category === "All" || i.category === category)
    .filter((i) => !query || i.name.toLowerCase().includes(query.toLowerCase()))
    // Connectable first, then alphabetical.
    .sort((a, b) => Number(!!b.connectable) - Number(!!a.connectable) || a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="The tools Orbit reads. Connect one and Orbit keeps memory up to date on its own. Your tools stay the system of record."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search integrations…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                category === c ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c === "All" ? "All" : catLabel(c)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No integrations in this category.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((i) => <IntegrationRow key={i.key} integration={i} onConnect={onConnect} />)}
        </div>
      )}

      <LinearDialog open={dialogOpen} onOpenChange={setDialogOpen} oauthAvailable={linearOAuthAvailable} onOAuth={() => startOAuth("linear")} />
    </div>
  );
}
