import type { Finding, IntegrationKey } from "./types";

// Artifact source string → connector key ("linear-issue" → "linear"). Null for
// non-connector memory (calls, documents), which renders a generic icon.
const NON_CONNECTOR = new Set(["call", "document", "doc", "note", "email", "manual"]);
export function sourceKey(source: string): IntegrationKey | null {
  const base = (source || "").split(/[-_ ]/)[0].toLowerCase();
  return !base || NON_CONNECTOR.has(base) ? null : (base as IntegrationKey);
}

export function findingSources(f: Finding): IntegrationKey[] {
  return Array.from(new Set(f.artifacts.map((a) => sourceKey(a.source)).filter((k): k is IntegrationKey => !!k)));
}

// Deterministic priority for findings — problems first, weighted by how much
// evidence backs them and how fresh they are. No fabricated scores.
const KIND_WEIGHT: Record<string, number> = { gap: 3, drift: 2.5, trend: 1.5, win: 1 };
export function rankFinding(f: Finding): number {
  const evidence = Math.min(f.entities.length + f.artifacts.length, 6) * 0.25;
  const ageDays = (Date.now() - new Date(f.createdAt).getTime()) / 86400000;
  const recency = Math.max(0, 1 - ageDays / 14) * 0.5;
  return (KIND_WEIGHT[f.kind] ?? 1) + evidence + recency;
}

export const SEVERITY: Record<string, { label: string; cls: string }> = {
  gap: { label: "High priority", cls: "text-warning" },
  drift: { label: "Medium priority", cls: "text-primary" },
  trend: { label: "Worth watching", cls: "text-info" },
  win: { label: "Win", cls: "text-success" },
};
