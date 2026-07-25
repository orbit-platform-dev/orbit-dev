"use client";

import { motion } from "framer-motion";
import {
  Lane,
  OrbitingTools,
  PHASE_STAGE,
  SyncStageTracker,
  useTypewriter,
} from "@/components/shared/sync-theater";
import { LiveCounts } from "@/components/shared/live-counts";
import type { SyncProgress } from "@/lib/types";

// Memory-tab sync visual: a knowledge graph GROWING — entities appear, edges
// draw in between them, and pulses travel the connections while Orbit distils
// what it read into memory. Shown instead of data while a sync runs.

type Node = {
  x: number;
  y: number;
  r: number;
  cls: string;
  label?: string;
  side?: "left" | "right";
};

const NODES: Node[] = [
  { x: 80, y: 62, r: 7, cls: "fill-info", label: "Customer", side: "left" },
  { x: 196, y: 38, r: 6, cls: "fill-warning", label: "Commitment", side: "right" },
  { x: 318, y: 60, r: 7, cls: "fill-primary", label: "Person", side: "right" },
  { x: 388, y: 132, r: 6, cls: "fill-success", label: "Project", side: "right" },
  { x: 128, y: 138, r: 5, cls: "fill-muted-foreground/70" },
  { x: 232, y: 122, r: 8, cls: "fill-primary" },
  { x: 92, y: 204, r: 5, cls: "fill-muted-foreground/70" },
  { x: 262, y: 202, r: 6, cls: "fill-info", label: "Decision", side: "right" },
  { x: 356, y: 214, r: 5, cls: "fill-muted-foreground/70" },
];

const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [0, 4],
  [4, 5],
  [1, 5],
  [5, 7],
  [6, 4],
  [7, 8],
  [5, 2],
  [6, 0],
  [3, 8],
];

// Edges that carry a traveling pulse once the graph has grown.
const PULSED: [number, number][] = [
  [0, 1],
  [5, 2],
  [4, 5],
];

export function MemoryTheater({ sync }: { sync?: SyncProgress | null }) {
  const phase = sync?.phase ?? "reading";
  const stage = PHASE_STAGE[phase] ?? 0;
  const typed = useTypewriter(
    sync?.message ?? "Connecting people, commitments and work into one living graph…",
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-border bg-card/40 px-4 py-12 backdrop-blur-xl sm:px-8"
    >
      <div className="flex w-full max-w-4xl flex-col items-center gap-8 lg:flex-row lg:gap-4">
        <OrbitingTools className="shrink-0" />
        <div className="hidden min-w-10 flex-1 lg:block">
          <Lane delay={0.5} />
        </div>
        <svg
          viewBox="0 0 460 250"
          className="h-auto w-full max-w-xl lg:max-w-lg"
          role="img"
          aria-label="Orbit is connecting what it read into a growing company knowledge graph."
        >
          <g className="stroke-border" strokeWidth={1}>
            {EDGES.map(([a, b], i) => (
              <motion.line
                key={i}
                x1={NODES[a].x}
                y1={NODES[a].y}
                x2={NODES[b].x}
                y2={NODES[b].y}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.5 + i * 0.18, ease: "easeOut" }}
              />
            ))}
          </g>

          {NODES.map((n, i) => (
            <g key={i}>
              {/* soft halo that keeps breathing after the graph has grown */}
              <motion.circle
                cx={n.x}
                cy={n.y}
                className={n.cls}
                opacity={0.15}
                initial={{ r: 0 }}
                animate={{ r: [n.r + 3, n.r + 8, n.r + 3] }}
                transition={{
                  duration: 3.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.4 + 1.5,
                }}
              />
              <motion.circle
                cx={n.x}
                cy={n.y}
                className={n.cls}
                initial={{ r: 0, opacity: 0 }}
                animate={{ r: n.r, opacity: 1 }}
                transition={{ duration: 0.45, delay: i * 0.16, ease: "backOut" }}
              />
              {n.label ? (
                <motion.text
                  x={n.side === "left" ? n.x - n.r - 6 : n.x + n.r + 6}
                  y={n.y + 3.5}
                  textAnchor={n.side === "left" ? "end" : "start"}
                  className="fill-muted-foreground"
                  fontSize={11}
                  fontWeight={500}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.16 + 0.35 }}
                >
                  {n.label}
                </motion.text>
              ) : null}
            </g>
          ))}

          {/* information traveling the graph — memory staying alive */}
          {PULSED.map(([a, b], i) => (
            <motion.circle
              key={`p${i}`}
              r={3}
              className="fill-primary"
              style={{ filter: "drop-shadow(0 0 5px hsl(var(--primary)))" }}
              initial={{ cx: NODES[a].x, cy: NODES[a].y, opacity: 0 }}
              animate={{
                cx: [NODES[a].x, NODES[b].x],
                cy: [NODES[a].y, NODES[b].y],
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 2.2 + i * 0.7,
              }}
            />
          ))}
        </svg>
      </div>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">
        {phase === "error"
          ? "Sync hit a snag — retrying shortly"
          : "Orbit is building your company memory"}
      </h2>
      <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
        {typed}
        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse rounded bg-primary/70 align-middle" />
      </p>

      <LiveCounts active={!!sync?.active} className="mt-6" />

      <SyncStageTracker stage={stage} />
    </motion.div>
  );
}
