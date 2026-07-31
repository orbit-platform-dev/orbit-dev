"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Plug, Search, Zap } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { McpCard } from "@/components/integrations/mcp-card";
import { useHeartbeat, useIntegrations, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
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
  notion: {
    name: "Notion",
    placeholder: "ntn_… or secret_…",
    help: "Notion → Settings → Connections → Develop or manage integrations → New internal integration (read content), then share the pages you want Orbit to read with it. Validated live; stored server-side, never exposed.",
  },
  fireflies: {
    name: "Fireflies",
    placeholder: "your Fireflies API key",
    help: "Fireflies → Settings → Developer settings (Personal tab) → API key. Validated live; stored server-side, never exposed.",
  },
};

function KeyConnectDialog({
  provider,
  onOpenChange,
  oauthAvailable,
  onOAuth,
}: {
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
        <DialogHeader>
          <DialogTitle>Connect {info?.name}</DialogTitle>
        </DialogHeader>
        {oauthAvailable && (
          // Preferred path: one click, no secret to copy. Full browser redirect.
          <div className="space-y-3">
            <Button className="w-full" onClick={onOAuth}>
              <Plug className="h-4 w-4" /> Connect with {info?.name}
            </Button>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or use an API key{" "}
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="connect-key">Personal API key</Label>
          <Input
            id="connect-key"
            placeholder={info?.placeholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{info?.help}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending || !key.trim()}>
            {connect.isPending ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CirclebackConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const [hook, setHook] = useState<{ url: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setHook(null);
      setSecret("");
      return;
    }
    api
      .getWebhookUrl("circleback")
      .then(setHook)
      .catch(() => toast.error("Could not generate the webhook URL"));
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
        <DialogHeader>
          <DialogTitle>Connect Circleback</DialogTitle>
        </DialogHeader>
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
          <Input
            id="cb-secret"
            placeholder="whsec_…"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Copy the signing secret Circleback shows after adding the webhook. Stored server-side,
            used only to verify deliveries.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending || !secret.trim()}>
            {connect.isPending ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function SyncStatus({ integration, autoSync }: { integration: Integration; autoSync?: boolean }) {
  const enable = useMutation({
    mutationFn: async () => {
      const { url } = await api.getOAuthUrl(integration.key, true);
      window.location.href = url;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start the upgrade"),
  });

  const at = integration.lastSync;
  const live = !!integration.liveEvents;
  const overdue =
    !!at && !live && autoSync !== false && Date.now() - new Date(at).getTime() > STALE_AFTER_MS;

  const mode = live ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live
    </span>
  ) : autoSync === false ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-warning">Manual only</span>
      </TooltipTrigger>
      <TooltipContent>Auto-sync is off, so this refreshes only when you pull.</TooltipContent>
    </Tooltip>
  ) : (
    <span>Scheduled</span>
  );

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {mode}
      <span className="text-muted-foreground/40">·</span>
      {at ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={overdue ? "text-warning" : undefined}>
              {live ? "updated" : "synced"} {timeAgo(at)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{new Date(at).toLocaleString()}</TooltipContent>
        </Tooltip>
      ) : (
        <span>waiting for first sync</span>
      )}
      {integration.canEnableLive && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => enable.mutate()}
                disabled={enable.isPending}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <Zap className="h-3 w-3" /> Enable live
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Live updates need a workspace admin to re-authorize; polling covers it meanwhile.
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function IntegrationRow({
  integration,
  onConnect,
  autoSync,
}: {
  integration: Integration;
  onConnect: (key: string) => void;
  autoSync?: boolean;
}) {
  const qc = useQueryClient();
  const connected = integration.status === "connected" || integration.status === "syncing";
  const needsReconnect = integration.status === "reconnect"; // token expired / scope missing
  const canConnectNow =
    !!integration.connectable &&
    (integration.key in KEY_CONNECT ||
      !!integration.oauthAvailable ||
      integration.key === "circleback");
  const disconnect = useMutation({
    mutationFn: () => api.disconnectIntegration(integration.key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success(`${integration.name} disconnected`);
    },
  });
  const comingSoon = !canConnectNow && !connected;
  return (
    <Card
      className={cn(
        "relative flex items-center gap-4 overflow-hidden p-4",
        comingSoon && "select-none",
      )}
    >
      {/* Frosted glass reads as "visible but not yet yours" — the connector stays
          legible underneath, so the roadmap still communicates what is coming. */}
      {comingSoon && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/40 backdrop-blur-[3px] supports-[not(backdrop-filter:blur(0))]:bg-card/80">
          <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-medium tracking-wide text-foreground/80 shadow-sm backdrop-blur-md">
            Coming soon
          </span>
        </div>
      )}
      <IntegrationLogo k={integration.key} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{integration.name}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {catLabel(integration.category)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{integration.description}</p>
        {/* Status belongs with the connector's identity, not wedged against the
            action: at two cards per row there is no width to share. */}
        {connected && <SyncStatus integration={integration} autoSync={autoSync} />}
      </div>
      {connected ? (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
        >
          Disconnect
        </Button>
      ) : needsReconnect && canConnectNow ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-medium text-warning">Session expired</span>
          <Button size="sm" onClick={() => onConnect(integration.key)}>
            <Plug className="h-4 w-4" /> Reconnect
          </Button>
        </div>
      ) : canConnectNow ? (
        <Button size="sm" onClick={() => onConnect(integration.key)}>
          <Plug className="h-4 w-4" /> Connect
        </Button>
      ) : null}
    </Card>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const OAUTH_ERROR_MSG: Record<string, string> = {
  state: "Sign-in expired, please try again",
  exchange: "The provider rejected the sign-in, please try again",
};

function ConnectorSection({
  label,
  count,
  note,
  className,
  children,
}: {
  label: string;
  count: number;
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {count}
        </span>
        <span className="h-px flex-1 bg-border" />
        {note && <span className="hidden text-[11px] text-muted-foreground sm:inline">{note}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useIntegrations();
  // Whether the schedule is actually running decides what "scheduled" can promise.
  const { data: heartbeat } = useHeartbeat();
  const autoSync = heartbeat?.enabled ?? undefined;
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

  const oauthAvailable = (key: string | null) =>
    !!(data ?? []).find((i) => i.key === key)?.oauthAvailable;
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
    .sort((a, b) => a.name.localeCompare(b.name));

  // Two different decisions, so two sections: what you can wire up now, and what
  // is on the way. Sorting alone left them interleaved and unreadable.
  const available = filtered.filter((i) => i.connectable || i.status === "connected");
  const upcoming = filtered.filter((i) => !i.connectable && i.status !== "connected");

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="The tools Orbit reads. Connect one and Orbit keeps memory up to date on its own. Your tools stay the system of record."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search integrations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                category === c
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c === "MCP" ? (
                <span className="inline-flex items-center gap-1">
                  <Bot className="h-3 w-3" /> MCP
                </span>
              ) : c === "All" ? (
                "All"
              ) : (
                catLabel(c)
              )}
            </button>
          ))}
        </div>
      </div>

      {category === "MCP" ? (
        <McpCard />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No integrations in this category.
        </p>
      ) : (
        <>
          {available.length > 0 && (
            <ConnectorSection label="Available now" count={available.length}>
              {available.map((i) => (
                <IntegrationRow
                  key={i.key}
                  integration={i}
                  onConnect={onConnect}
                  autoSync={autoSync}
                />
              ))}
            </ConnectorSection>
          )}
          {upcoming.length > 0 && (
            <ConnectorSection
              label="Coming soon"
              count={upcoming.length}
              note="Built and on the way. Nothing for you to set up."
              className={available.length > 0 ? "mt-9" : undefined}
            >
              {upcoming.map((i) => (
                <IntegrationRow
                  key={i.key}
                  integration={i}
                  onConnect={onConnect}
                  autoSync={autoSync}
                />
              ))}
            </ConnectorSection>
          )}
        </>
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
