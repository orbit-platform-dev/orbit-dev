"use client";

// Lightweight, persisted preference for how agent-suggested work becomes tickets.
// Shared across ticket surfaces so the toggle stays in sync.
import { useSyncExternalStore } from "react";

export type TicketProvider = "linear" | "jira";

export interface TicketPrefs {
  /** When true, the Engineering Planner pushes tickets to the tool automatically.
   *  When false, it surfaces suggestions the user creates with one click. */
  autoCreate: boolean;
  provider: TicketProvider;
}

const KEY = "orbit.ticketPrefs";
const DEFAULT: TicketPrefs = { autoCreate: false, provider: "linear" };

let cache: TicketPrefs | null = null;
const listeners = new Set<() => void>();

function read(): TicketPrefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT;
  }
}

function getSnapshot(): TicketPrefs {
  if (cache === null) cache = read();
  return cache;
}

function getServerSnapshot(): TicketPrefs {
  return DEFAULT;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setTicketPrefs(patch: Partial<TicketPrefs>) {
  cache = { ...getSnapshot(), ...patch };
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l());
}

export function useTicketPrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { prefs, setPrefs: setTicketPrefs };
}
