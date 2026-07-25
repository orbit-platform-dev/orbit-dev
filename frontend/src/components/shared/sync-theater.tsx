"use client";

import { Fragment } from "react";
import { motion } from "framer-motion";
import { OrbitMark } from "@/components/shared/logo";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { LiveCounts } from "@/components/shared/live-counts";
import { useIntegrations } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { IntegrationKey, SyncProgress } from "@/lib/types";

// Full-tab "Orbit is reading your company" visual, shown INSTEAD of data while
// a sync is running: connected tools flow into the Orbit core, outputs flow
// out, and a stage tracker mirrors the live sync phase.

const PULLED_TOOLS: IntegrationKey[] = ["linear", "slack", "github", "google-drive", "fireflies"];
const TOOL_NAME: Record<string, string> = {
  linear: "Linear",
  slack: "Slack",
  github: "GitHub",
  "google-drive": "Google Drive",
  fireflies: "Fireflies",
};

const STAGES = ["Reading", "Understanding", "Reasoning", "Ready"];
export const PHASE_STAGE: Record<string, number> = { reading: 0, reasoning: 2, done: 3, error: 0 };

export function SyncStageTracker({ stage }: { stage: number }) {
  return (
    <div className="mt-8 flex items-center">
      {STAGES.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && (
            <span
              className={cn("mx-2 h-px w-6 sm:w-14", i <= stage ? "bg-primary/60" : "bg-border")}
            />
          )}
          <span
            className={cn(
              "flex items-center gap-1.5 text-[12px] font-medium",
              i < stage
                ? "text-foreground"
                : i === stage
                  ? "text-primary"
                  : "text-muted-foreground/60",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                i < stage ? "bg-primary" : i === stage ? "animate-pulse bg-primary" : "bg-border",
              )}
            />
            {s}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

const OUTPUTS = [
  { label: "Memory", dot: "bg-primary" },
  { label: "Insights", dot: "bg-info" },
  { label: "Actions", dot: "bg-success" },
];

function Pulse({ delay }: { delay: number }) {
  return (
    <motion.span
      className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-primary shadow-[0_0_10px_2px] shadow-primary/50"
      initial={{ left: "0%", opacity: 0 }}
      animate={{ left: ["0%", "94%"], opacity: [0, 1, 1, 0] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay }}
    />
  );
}

function Lane({ delay }: { delay: number }) {
  return (
    <div className="relative h-px min-w-8 flex-1 border-t border-dashed border-border/80">
      <Pulse delay={delay} />
      <Pulse delay={delay + 1.1} />
    </div>
  );
}

function Core() {
  return (
    <div className="relative mx-3 flex h-32 w-32 shrink-0 items-center justify-center sm:mx-5">
      <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-r-primary/20 border-t-primary/70 [animation-duration:2.8s]" />
      <div className="absolute inset-2.5 animate-spin rounded-full border border-transparent border-b-info/70 border-l-info/20 [animation-direction:reverse] [animation-duration:4.5s]" />
      <div className="absolute inset-6 rounded-full bg-primary/10 blur-md" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-background/80 shadow-[0_0_60px_-12px] shadow-primary/60 backdrop-blur">
        <OrbitMark className="h-9 w-9" />
      </div>
    </div>
  );
}

export function SyncTheater({ sync }: { sync?: SyncProgress | null }) {
  const { data: integrations } = useIntegrations();
  const tools = (integrations ?? [])
    .filter((i) => i.status === "connected" && PULLED_TOOLS.includes(i.key))
    .map((i) => i.key);
  const phase = sync?.phase ?? "reading";
  const stage = PHASE_STAGE[phase] ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-border bg-card/40 px-4 py-12 backdrop-blur-xl sm:px-8"
    >
      <div className="flex w-full max-w-3xl items-center">
        <div className="flex flex-1 flex-col gap-5">
          {tools.length
            ? tools.map((k, i) => (
                <motion.div
                  key={k}
                  className="flex items-center gap-2.5"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.12 }}
                >
                  <IntegrationLogo k={k} className="h-9 w-9 rounded-xl" />
                  <span className="hidden w-24 truncate text-sm font-medium md:block">
                    {TOOL_NAME[k] ?? k}
                  </span>
                  <Lane delay={i * 0.45} />
                </motion.div>
              ))
            : Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="h-9 w-9 animate-pulse rounded-xl border border-border/60 bg-muted/60" />
                  <span className="hidden h-3 w-20 animate-pulse rounded bg-muted/60 md:block" />
                  <Lane delay={i * 0.45} />
                </div>
              ))}
        </div>

        <Core />

        <div className="flex flex-1 flex-col gap-5">
          {OUTPUTS.map((o, i) => (
            <motion.div
              key={o.label}
              className="flex items-center gap-2.5"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.15 }}
            >
              <Lane delay={0.9 + i * 0.5} />
              <span className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium">
                <span className={cn("h-1.5 w-1.5 rounded-full", o.dot)} /> {o.label}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      <h2 className="mt-10 text-lg font-semibold tracking-tight">
        {phase === "error" ? "Sync hit a snag — retrying shortly" : ""}
      </h2>
      <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
        {sync?.message ?? ""}
      </p>

      <LiveCounts active={!!sync?.active} className="mt-6" />

      <SyncStageTracker stage={stage} />
    </motion.div>
  );
}
