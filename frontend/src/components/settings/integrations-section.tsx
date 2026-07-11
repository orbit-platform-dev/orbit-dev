"use client";

import Link from "next/link";
import { ArrowRight, Plug } from "lucide-react";
import { useIntegrations } from "@/lib/hooks";
import { timeAgo } from "@/lib/utils";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { IntegrationStatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "./shared";

export function IntegrationsSection() {
  const { data: integrations, isLoading } = useIntegrations();

  const connected = (integrations ?? []).filter((i) => i.status === "connected" || i.status === "syncing");

  return (
    <>
      <SectionHeader
        title="Integrations"
        description="A snapshot of your connected apps. Manage them in detail on the integrations page."
        action={
          <Button asChild className="gap-2">
            <Link href="/integrations">
              Manage integrations <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-5">
          {isLoading || !integrations ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : connected.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No integrations connected"
              description="Connect the tools Orbit reads signals from and syncs approved work back to."
              action={
                <Button asChild>
                  <Link href="/integrations">Browse integrations</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">{connected.length}</span> of{" "}
                  <span className="tabular-nums">{integrations.length}</span> apps connected
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {connected.map((i) => (
                  <div
                    key={i.key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3"
                  >
                    <IntegrationLogo k={i.key} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {i.account ?? i.category}
                        {i.lastSync ? ` · synced ${timeAgo(i.lastSync)}` : ""}
                      </div>
                    </div>
                    <IntegrationStatusBadge status={i.status} />
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
