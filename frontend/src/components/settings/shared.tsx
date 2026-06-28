"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Building2, Users, Plug, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tab registry — single source of truth for nav + routing.
// Kept intentionally minimal for the MVP.
// ---------------------------------------------------------------------------
export type SettingsTab = "workspace" | "members" | "integrations";

export const SETTINGS_TABS: { id: SettingsTab; label: string; icon: LucideIcon; description: string }[] = [
  { id: "workspace", label: "Workspace", icon: Building2, description: "Name and workspace defaults." },
  { id: "members", label: "Members", icon: Users, description: "Invite teammates and manage roles." },
  { id: "integrations", label: "Integrations", icon: Plug, description: "Connected apps and data sources." },
];

export const DEFAULT_TAB: SettingsTab = "workspace";

export function isSettingsTab(v: string | null | undefined): v is SettingsTab {
  return !!v && SETTINGS_TABS.some((t) => t.id === v);
}

// ---------------------------------------------------------------------------
// Section transition wrapper — subtle fade + lift on tab change.
// ---------------------------------------------------------------------------
export function SectionMotion({ children, tab }: { children: React.ReactNode; tab: string }) {
  return (
    <motion.div
      key={tab}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Header used at the top of each section.
// ---------------------------------------------------------------------------
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A labelled form row — label/help on the left, control on the right at md+.
// ---------------------------------------------------------------------------
export function FieldRow({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-start md:gap-6", className)}>
      <div className="space-y-0.5">
        <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
          {label}
        </label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
