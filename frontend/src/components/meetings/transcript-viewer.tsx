"use client";

import * as React from "react";
import { Search } from "lucide-react";
import type { TranscriptSegment } from "@/lib/types";
import { cn, colorFromString, formatDuration, initials } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const sentimentBar: Record<string, string> = {
  positive: "bg-success",
  negative: "bg-destructive",
  mixed: "bg-warning",
  neutral: "bg-transparent",
};

export function TranscriptViewer({ segments }: { segments: TranscriptSegment[] }) {
  const [q, setQ] = React.useState("");
  const filtered = q ? segments.filter((s) => s.text.toLowerCase().includes(q.toLowerCase())) : segments;

  function highlight(text: string) {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="rounded bg-primary/30 px-0.5 text-foreground">{p}</mark>
      ) : (
        <React.Fragment key={i}>{p}</React.Fragment>
      ),
    );
  }

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcript…" className="pl-9" />
      </div>
      <div className="space-y-1">
        {filtered.map((s) => {
          const color = colorFromString(s.speaker);
          return (
            <div key={s.id} className="group flex gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent/50">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{ background: `${color}22`, color }}
                >
                  {initials(s.speaker)}
                </div>
                {s.sentiment && s.sentiment !== "neutral" && (
                  <div className={cn("h-full w-0.5 rounded-full", sentimentBar[s.sentiment])} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium" style={{ color }}>{s.speaker}</span>
                  {s.speakerRole && <span className="text-xs text-muted-foreground">{s.speakerRole}</span>}
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatDuration(s.start)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-foreground/85">{highlight(s.text)}</p>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No matching lines.</p>}
      </div>
    </div>
  );
}
