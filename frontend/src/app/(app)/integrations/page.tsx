"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Plug, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { McpCard } from "@/components/integrations/mcp-card";
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

const KEY_CONNECT: Record<string, { name: string; placeholder: string; help: string }> = {
  linear: {
    name: "Linear",
    placeholder: "lin_api_…",
    help: "Linear → Settings → Security & access → Personal API keys. Validated live; stored server-side, never exposed.",
  },
  github: {
    name: "GitHub",
    placeholder: "ghp_… or github_pat_…",
    help: "GitHub → Settings → Developer settings → Personal access tokens (repo read access). Validated live; stored server-side, never exposed.",
  },
  fireflies: {
    name: "Fireflies",
    placeholder: "your Fireflies API key",
    help: "Fireflies → Settings → Developer settings (Personal tab) → API key. Validated live; stored server-side, never exposed.",
  },
};

function KeyConnectDialog({ provider, onOpenChange, oauthAvailable, onOAuth }: {
  provider: string | null;
  onOpenChange: (o: boolean) => void;
  oauthAvailable: boolean;
  onOAuth: () => void;
}) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const info = provider ? KEY_CONNECT[provider] : null;
  const connect = useMutation({
    mutationFn: () => api.connectWithKey(provider!, key.trim()),
    onSuccess: (i) => {
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success(`${info?.name} connected${i.account ? ` · ${i.account}` : ""}`);
      onOpenChange(false);
      setKey("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : `Could not connect ${info?.name}`),
  });
  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect {info?.name}</DialogTitle></DialogHeader>
        {oauthAvailable && (
          // Preferred path: one click, no secret to copy. Full browser redirect.
          <div className="space-y-3">
            <Button className="w-full" onClick={onOAuth}>
              <Plug className="h-4 w-4" /> Connect with {info?.name}
            </Button>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or use an API key <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="connect-key">Personal API key</Label>
          <Input id="connect-key" placeholder={info?.placeholder} value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="text-xs text-muted-foreground">{info?.help}</p>
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

function CirclebackConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const [hook, setHook] = useState<{ url: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) { setHook(null); setSecret(""); return; }
    api.getWebhookUrl("circleback").then(setHook).catch(() => toast.error("Could not generate the webhook URL"));
  }, [open]);

  const connect = useMutation({
    mutationFn: () => api.connectWithKey("circleback", secret.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success("Circleback connected");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not connect Circleback"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect Circleback</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          <Label>1 · Webhook URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={hook?.url ?? "Generating…"} className="font-mono text-xs" />
            <Button
              variant="outline"
              disabled={!hook?.url}
              onClick={() => {
                if (!hook?.url) return;
                navigator.clipboard.writeText(hook.url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {hook?.note ?? "In Circleback → Automations → Send webhook request, paste this URL."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cb-secret">2 · Signing secret</Label>
          <Input id="cb-secret" placeholder="whsec_…" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Copy the signing secret Circleback shows after adding the webhook. Stored server-side, used only to verify deliveries.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending || !secret.trim()}>
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
  const needsReconnect = integration.status === "reconnect";  // token expired / scope missing
  const canConnectNow = !!integration.connectable
    && (integration.key in KEY_CONNECT || !!integration.oauthAvailable || integration.key === "circleback");
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
      ) : needsReconnect && canConnectNow ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-medium text-warning">Session expired</span>
          <Button size="sm" onClick={() => onConnect(integration.key)}><Plug className="h-4 w-4" /> Reconnect</Button>
        </div>
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
  const [dialogProvider, setDialogProvider] = useState<string | null>(null);
  const [circlebackOpen, setCirclebackOpen] = useState(false);

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

  const oauthAvailable = (key: string | null) => !!(data ?? []).find((i) => i.key === key)?.oauthAvailable;
  const startOAuth = async (key: string) => {
    try {
      const { url } = await api.getOAuthUrl(key);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not start ${cap(key)} sign-in`);
    }
  };

  const onConnect = (key: string) => {
    if (key === "circleback") setCirclebackOpen(true);
    else if (oauthAvailable(key)) startOAuth(key);
    else if (key in KEY_CONNECT) setDialogProvider(key);
  };

  // MCP is not a connector category: it is the workspace's own agent-access tab.
  const categories = useMemo(() => {
    const set = Array.from(new Set((data ?? []).map((i) => i.category)));
    return ["All", ...set, "MCP"];
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
              {c === "MCP" ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" /> MCP</span> : c === "All" ? "All" : catLabel(c)}
            </button>
          ))}
        </div>
      </div>

      {category === "MCP" ? (
        <McpCard />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No integrations in this category.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((i) => <IntegrationRow key={i.key} integration={i} onConnect={onConnect} />)}
        </div>
      )}

      <KeyConnectDialog
        provider={dialogProvider}
        onOpenChange={(o) => !o && setDialogProvider(null)}
        oauthAvailable={oauthAvailable(dialogProvider)}
        onOAuth={() => dialogProvider && startOAuth(dialogProvider)}
      />
      <CirclebackConnectDialog open={circlebackOpen} onOpenChange={setCirclebackOpen} />
    </div>
  );
}
