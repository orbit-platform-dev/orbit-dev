"use client";

import { cn } from "@/lib/utils";

export type TimeRange = "all" | "day" | "week" | "month";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "all", label: "All" },
  { value: "day", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const DAYS: Record<Exclude<TimeRange, "all">, number> = { day: 1, week: 7, month: 30 };

const LABELS: Record<TimeRange, string> = {
  all: "All time",
  day: "Today",
  week: "This week",
  month: "This month",
};

export const rangeLabel = (range: TimeRange) => LABELS[range];

/** True if `dateStr` falls within the selected trailing window. */
export function withinRange(dateStr: string | undefined, range: TimeRange): boolean {
  if (range === "all" || !dateStr) return true;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= DAYS[range] * 86_400_000;
}

export function TimeFilter({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === r.value
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
