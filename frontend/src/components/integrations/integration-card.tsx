"use client";

import { motion } from "framer-motion";
import { Loader2, Settings2, AlertTriangle, MoreVertical, Plug, Unplug } from "lucide-react";
import type { Integration, IntegrationStatus } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { IntegrationStatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

export function IntegrationCard({
  integration,
  onConnect,
  onDisconnect,
  onReconnect,
  onConfigure,
}: {
  integration: Integration;
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onConfigure: () => void;
}) {
  const { name, category, description, status, lastSync, account, stats } = integration;

  return (
    <motion.div variants={cardVariants} transition={{ duration: 0.28 }}>
      <div className="group flex h-full flex-col rounded-xl border border-border bg-card shadow-card transition-colors hover:border-border/80 hover:bg-accent/30">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 pb-3">
          <IntegrationLogo k={integration.key} className="h-11 w-11 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold leading-tight">{name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{category}</p>
              </div>
              <IntegrationStatusBadge status={status} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3 px-5 pb-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>

          {(status === "connected" || status === "syncing") && (lastSync || account) ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {lastSync ? (
                <span className="inline-flex items-center gap-1">
                  {status === "syncing" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin text-info" /> Syncing…
                    </>
                  ) : (
                    <>Synced {timeAgo(lastSync)}</>
                  )}
                </span>
              ) : null}
              {lastSync && account ? <span aria-hidden>·</span> : null}
              {account ? <span className="truncate font-medium text-foreground/80">{account}</span> : null}
            </div>
          ) : null}

          {status === "error" ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Action needed{lastSync ? ` · last synced ${timeAgo(lastSync)}` : ""}
            </div>
          ) : null}

          {stats && stats.length > 0 && status !== "disconnected" ? (
            <div className="flex flex-wrap gap-1.5">
              {stats.map((s) => (
                <span
                  key={s.label}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <span className="font-semibold tabular-nums text-foreground">{s.value}</span>
                  {s.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer action */}
        <div className="mt-auto flex items-center gap-2 border-t border-border/60 px-5 py-3">
          <FooterAction
            status={status}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onReconnect={onReconnect}
            onConfigure={onConfigure}
            name={name}
          />
        </div>
      </div>
    </motion.div>
  );
}

function FooterAction({
  status,
  onConnect,
  onDisconnect,
  onReconnect,
  onConfigure,
}: {
  status: IntegrationStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onConfigure: () => void;
  name: string;
}) {
  if (status === "coming-soon") {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled>
        Coming soon
      </Button>
    );
  }

  if (status === "disconnected") {
    return (
      <Button size="sm" className="gap-1.5" onClick={onConnect}>
        <Plug className="h-3.5 w-3.5" /> Connect
      </Button>
    );
  }

  if (status === "error") {
    return (
      <>
        <Button size="sm" variant="destructive" className="gap-1.5" onClick={onReconnect}>
          <AlertTriangle className="h-3.5 w-3.5" /> Reconnect
        </Button>
        <Button size="sm" variant="ghost" onClick={onConfigure}>
          Configure
        </Button>
      </>
    );
  }

  if (status === "syncing") {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
      </Button>
    );
  }

  // connected
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={onConfigure}>
        <Settings2 className="h-3.5 w-3.5" /> Configure
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Manage integration">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Manage</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onConfigure}>
            <Settings2 className="h-4 w-4" /> Configure
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onDisconnect}
            className="text-destructive focus:text-destructive [&_svg]:text-destructive"
          >
            <Unplug className="h-4 w-4" /> Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
