"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  SETTINGS_TABS,
  DEFAULT_TAB,
  isSettingsTab,
  SectionMotion,
  type SettingsTab,
} from "@/components/settings/shared";
import { WorkspaceSection } from "@/components/settings/workspace-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";

function renderSection(tab: SettingsTab) {
  switch (tab) {
    case "workspace":
      return <WorkspaceSection />;
    case "integrations":
      return <IntegrationsSection />;
  }
}

function SettingsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: SettingsTab = isSettingsTab(raw) ? raw : DEFAULT_TAB;

  const go = (id: SettingsTab) => router.push(`/settings?tab=${id}`, { scroll: false });

  return (
    <div>
      <PageHeader title="Settings" description="Manage your workspace, team and security." />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left nav (lg+) */}
        <nav aria-label="Settings sections" className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-0 space-y-0.5">
            {SETTINGS_TABS.map((t) => {
              const active = t.id === tab;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => go(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "")} />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Mobile: horizontal scroll row + select */}
        <div className="lg:hidden">
          <div className="mb-4 sm:hidden">
            <Select value={tab} onValueChange={(v) => go(v as SettingsTab)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SETTINGS_TABS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="no-scrollbar -mx-4 hidden gap-2 overflow-x-auto px-4 pb-1 sm:flex">
            {SETTINGS_TABS.map((t) => {
              const active = t.id === tab;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => go(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "border-border bg-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active section */}
        <div className="min-w-0 flex-1">
          <SectionMotion tab={tab}>{renderSection(tab)}</SectionMotion>
        </div>
      </div>
    </div>
  );
}

function SettingsFallback() {
  return (
    <div>
      <PageHeader title="Settings" description="Manage your workspace, team and security." />
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="hidden w-56 shrink-0 space-y-2 lg:block">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsContent />
    </Suspense>
  );
}
