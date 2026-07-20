"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

// Live proof-of-work: real DB counts polled while a sync runs, so users watch
// memory grow (numbers tick up) instead of staring at a screen that looks hung.

function useCountUp(target: number) {
  const [shown, setShown] = React.useState(target);
  const raf = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (shown === target) return;
    const start = shown;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min((t - t0) / 600, 1);
      setShown(Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return shown;
}

function Stat({ label, value, active }: { label: string; value: number; active: boolean }) {
  const shown = useCountUp(value);
  return (
    <div className="flex min-w-[7.5rem] flex-col items-center rounded-xl border border-border bg-card px-4 py-3">
      <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", active && "text-primary")}>
        {shown.toLocaleString()}
      </span>
      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

export function LiveCounts({ active, className }: { active: boolean; className?: string }) {

  const { data } = useQuery({
    queryKey: ["memory", "counts"],
    queryFn: api.getMemoryCounts,
    refetchInterval: active ? 2000 : false,
  });
  if (!data) return null;
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Stat label="Signals read" value={data.artifacts} active={active} />
        <Stat label="Entities" value={data.entities} active={active} />
        <Stat label="Facts learned" value={data.facts} active={active} />
        <Stat label="Insights" value={data.insights} active={active} />
      </div>
      {active ? (
        <span className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Live from your company memory
        </span>
      ) : null}
    </div>
  );
}
