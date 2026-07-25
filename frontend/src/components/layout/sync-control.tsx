"use client";

import { RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useHeartbeat, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

/**
 * The one place to control syncing, shown in the top bar on every page:
 * a manual "Pull now" and an "Auto" toggle. Pull runs the full read + reason
 * (progress shows in the Feed's scan surface); Auto flips the heartbeat.
 */
export function SyncControl() {
  const qc = useQueryClient();
  const { data: hb } = useHeartbeat();
  const enabled = hb?.enabled ?? false;
  const syncing = !!hb?.sync?.active;

  const pull = useMutation({
    mutationFn: api.scanFeed,
    onSuccess: (status) => {
      qc.setQueryData(qk.heartbeat, status);
      qc.invalidateQueries({ queryKey: qk.feed });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Pull failed"),
  });

  const auto = useMutation({
    mutationFn: (next: boolean) => api.setAutoSync(next),
    onSuccess: (status) => {
      qc.setQueryData(qk.heartbeat, status);
      toast.success(status.enabled ? "Auto-sync on" : "Auto-sync off");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update auto-sync"),
  });

  const busy = syncing || pull.isPending;

  return (
    <div className="hidden items-center gap-2.5 md:flex">
      {/* Fixed widths on the button + status so the switch never shifts. */}
      <button
        onClick={() => pull.mutate()}
        disabled={busy}
        className="inline-flex h-9 min-w-[92px] items-center justify-center gap-1.5 rounded-lg border border-border bg-card/40 px-2.5 text-xs font-medium transition-colors hover:bg-card/70 disabled:opacity-60"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
        {syncing ? "Syncing…" : "Pull now"}
      </button>
      <div
        className="flex items-center gap-2"
        title={hb?.lastRunAt ? `Last synced ${timeAgo(hb.lastRunAt)}` : undefined}
      >
        <Switch checked={enabled} onCheckedChange={(v) => auto.mutate(v)} aria-label="Auto-sync" />
        {/* Fixed width so on/off never nudges the switch. */}
        <span className="inline-block w-[86px] text-[11px] text-muted-foreground">
          {enabled ? "Auto-sync on" : "Auto-sync off"}
        </span>
      </div>
    </div>
  );
}
