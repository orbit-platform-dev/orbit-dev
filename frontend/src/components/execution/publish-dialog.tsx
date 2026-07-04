"use client";


import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, ExternalLink, FileDown, FileText, Loader2 } from "lucide-react";
import * as api from "@/lib/api";
import { qk, useIntegrations } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import type { PrdDestination, PublishOutcome } from "./publish-destinations";

export function PublishDialog({
  trigger, title, description, destinations, publish, onDone, initialLinks = [],
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  destinations: PrdDestination[];
  publish: (dest: PrdDestination) => Promise<PublishOutcome>;
  onDone?: () => void;
  initialLinks?: PublishOutcome[];
}) {
  const [open, setOpen] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [connectingKey, setConnectingKey] = React.useState<string | null>(null);
  const [justConnected, setJustConnected] = React.useState<Set<string>>(new Set());
  const [done, setDone] = React.useState<Record<string, PublishOutcome>>(() =>
    Object.fromEntries(initialLinks.map((o) => [o.key, o])),
  );
  React.useEffect(() => {
    if (initialLinks.length) setDone((prev) => ({ ...Object.fromEntries(initialLinks.map((o) => [o.key, o])), ...prev }));
  }, [initialLinks]);

  // Transient "Downloaded ✓" confirmation for PDF that reverts to the Download button.
  const [flash, setFlash] = React.useState<Set<string>>(new Set());
  const flashTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  React.useEffect(() => () => { Object.values(flashTimers.current).forEach(clearTimeout); }, []);
  const flashDownloaded = (key: string) => {
    setFlash((prev) => new Set(prev).add(key));
    clearTimeout(flashTimers.current[key]);
    flashTimers.current[key] = setTimeout(
      () => setFlash((prev) => { const next = new Set(prev); next.delete(key); return next; }),
      2500,
    );
  };

  const { data: integrations } = useIntegrations();
  const qc = useQueryClient();

  const isConnected = (integrationKey: string | null) =>
    integrationKey === null ||
    justConnected.has(integrationKey) ||
    !!integrations?.some((i) => i.key === integrationKey && (i.status === "connected" || i.status === "syncing"));

  const connect = async (integrationKey: string, name: string) => {
    setConnectingKey(integrationKey);
    try {
      await api.patchIntegration(integrationKey, "connected");
      setJustConnected((prev) => new Set(prev).add(integrationKey));
      qc.invalidateQueries({ queryKey: qk.integrations });
      toast.success(`${name} connected`);
    } catch {
      toast.error(`Couldn't connect ${name}`);
    } finally {
      setConnectingKey(null);
    }
  };

  const act = async (d: PrdDestination) => {
    setBusyKey(d.key);
    try {
      const outcome = await publish(d);
      // PDF: flash a brief confirmation, then revert so it stays re-downloadable.
      if (d.integrationKey === null) flashDownloaded(d.key);
      else setDone((prev) => ({ ...prev, [d.key]: outcome }));
      onDone?.();
      toast.success(d.integrationKey === null ? `${d.name} downloaded` : outcome.url ? `Published to ${d.name}` : `Pushed to ${d.name}`);
    } catch (e) {
      toast.error(`Couldn't send to ${d.name}`, { description: (e as Error).message });
    } finally {
      setBusyKey(null);
    }
  };

  const persistedLinks = Object.values(done).filter((o) => o.url);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {persistedLinks.map((o) => (
        <Button key={o.key} asChild size="sm" variant="outline" className="gap-1.5">
          <a href={o.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" /> Open in {o.name}
          </a>
        </Button>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            {destinations.map((d) => {
              const noAuth = d.integrationKey === null;
              const connected = isConnected(d.integrationKey);
              const outcome = done[d.key];
              const busy = busyKey === d.key;
              return (
                <div key={d.key} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  {noAuth ? (
                    <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                  ) : (
                    <IntegrationLogo k={d.integrationKey!} className="h-7 w-7" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs">
                      {noAuth ? (
                        <span className="text-muted-foreground">Always available</span>
                      ) : connected ? (
                        <span className="inline-flex items-center gap-1 text-success"><Check className="h-3 w-3" /> Connected</span>
                      ) : (
                        <span className="text-muted-foreground">Not connected</span>
                      )}
                    </div>
                  </div>

                  {/* One action per row: push (connected), download (PDF), or connect. */}
                  {outcome ? (
                    outcome.url ? (
                      <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <a href={outcome.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <Check className="h-3.5 w-3.5" /> {noAuth ? "Downloaded" : "Pushed"}
                      </span>
                    )
                  ) : noAuth ? (
                    flash.has(d.key) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Downloaded</span>
                    ) : (
                      <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => act(d)}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} Download
                      </Button>
                    )
                  ) : connected ? (
                    <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => act(d)}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />} Push
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={connectingKey === d.integrationKey}
                      onClick={() => connect(d.integrationKey!, d.name)}
                    >
                      {connectingKey === d.integrationKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Connect"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
