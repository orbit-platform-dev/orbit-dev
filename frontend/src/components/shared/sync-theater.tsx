"use client";

import { Fragment, useEffect, useState } from "react";
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

export function SyncStageTracker({ stage, className }: { stage: number; className?: string }) {
  return (
    <div className={className ?? "mt-8 flex items-center"}>
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

export function Lane({ delay }: { delay: number }) {
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
      <OrbitMark className="relative h-12 w-12 drop-shadow-[0_0_16px_hsl(var(--primary)/0.5)]" />
    </div>
  );
}

export function useTypewriter(text: string, speed = 16): string {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return shown;
}

const PHASE_MESSAGE: Record<string, string> = {
  reading: "Reading new signals from your tools…",
  reasoning: "Building your company model and reasoning across it…",
  done: "Up to date.",
  error: "Sync hit a snag — retrying shortly.",
};

export function ToolsToCore({ className }: { className?: string }) {
  const { data: integrations } = useIntegrations();
  const tools = (integrations ?? [])
    .filter((i) => i.status === "connected" && PULLED_TOOLS.includes(i.key))
    .map((i) => i.key);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex items-center gap-2">
        {tools.slice(0, 5).map((k, i) => (
          <motion.span
            key={k}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="inline-flex"
          >
            <IntegrationLogo k={k} bare className="h-6 w-6 drop-shadow-sm" />
          </motion.span>
        ))}
      </div>
      <div className="w-14">
        <Lane delay={0} />
      </div>
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-primary/70 [animation-duration:2.2s]" />
        <div className="absolute inset-1 animate-spin rounded-full border border-transparent border-b-info/50 [animation-direction:reverse] [animation-duration:3.6s]" />
        <OrbitMark className="h-5 w-5" />
      </div>
    </div>
  );
}

// Three orbits at different radii/speeds, alternating direction for depth.
// Guide insets must match each radius: container is 208px (half 104).
const ORBIT_RINGS = [
  { radius: 100, duration: 36, reverse: false, size: "h-7 w-7", guide: "inset-1 border-border/70" },
  {
    radius: 72,
    duration: 26,
    reverse: false,
    size: "h-6 w-6",
    guide: "inset-8 border-dashed border-border/60",
  },
  {
    radius: 46,
    duration: 18,
    reverse: false,
    size: "h-5 w-5",
    guide: "inset-[58px] border-dotted border-border/50",
  },
];

export function OrbitingTools({ className }: { className?: string }) {
  const { data: integrations } = useIntegrations();
  const tools = (integrations ?? [])
    .filter((i) => i.status === "connected" && PULLED_TOOLS.includes(i.key))
    .map((i) => i.key)
    .slice(0, 6);
  const byRing = ORBIT_RINGS.map((_, ri) => tools.filter((_, i) => i % ORBIT_RINGS.length === ri));
  return (
    <div className={cn("relative h-52 w-52", className)}>
      {ORBIT_RINGS.map((ring, ri) => (
        <div key={ri} className={cn("absolute rounded-full border", ring.guide)} />
      ))}
      <div className="absolute inset-16 rounded-full bg-primary/10 blur-md" />
      <div className="absolute inset-0 flex items-center justify-center">
        <OrbitMark className="h-12 w-12 drop-shadow-[0_0_16px_hsl(var(--primary)/0.5)]" />
      </div>
      {ORBIT_RINGS.map((ring, ri) => {
        const ringTools = byRing[ri];
        if (!ringTools.length) return null;
        const spin = {
          animationDuration: `${ring.duration}s`,
          animationDirection: ring.reverse ? ("reverse" as const) : ("normal" as const),
        };
        const unspin = {
          animationDuration: `${ring.duration}s`,
          animationDirection: ring.reverse ? ("normal" as const) : ("reverse" as const),
        };
        return (
          <div key={ri} className="absolute inset-0 animate-spin" style={spin}>
            {ringTools.map((k, i) => {
              const angle = (360 / ringTools.length) * i + ri * 60;
              return (
                <div
                  key={k}
                  className="absolute left-1/2 top-1/2 h-0 w-0"
                  style={{
                    transform: `rotate(${angle}deg) translateX(${ring.radius}px) rotate(-${angle}deg)`,
                  }}
                >
                  {/* opposite spin cancels the carrier's rotation so logos stay upright */}
                  <div className="absolute -translate-x-1/2 -translate-y-1/2">
                    <div className="animate-spin" style={unspin}>
                      <IntegrationLogo k={k} bare className={cn(ring.size, "drop-shadow-sm")} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function SyncBanner({
  sync,
  openFindings,
}: {
  sync?: SyncProgress | null;
  openFindings?: number;
}) {
  const phase = sync?.phase ?? "reading";
  const stage = PHASE_STAGE[phase] ?? 0;
  const message = sync?.message || PHASE_MESSAGE[phase] || PHASE_MESSAGE.reading;
  const typed = useTypewriter(message);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative mb-6 overflow-hidden rounded-2xl border border-primary/20 bg-card/40 px-5 py-4 backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute -top-16 left-1/3 h-32 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex items-center gap-5">
        <ToolsToCore className="hidden shrink-0 sm:flex" />

        <div className="min-w-0 flex-1">
          <SyncStageTracker stage={stage} className="flex items-center" />
          <p className="mt-1.5 truncate text-sm text-muted-foreground">
            {typed}
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse rounded bg-primary/70 align-middle" />
          </p>
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-1 md:flex">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Feed stays live
          </span>
          {typeof openFindings === "number" && openFindings > 0 ? (
            <span className="text-xs text-muted-foreground">
              {openFindings} finding{openFindings === 1 ? "" : "s"} open below
            </span>
          ) : null}
        </div>
      </div>
    </motion.div>
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
