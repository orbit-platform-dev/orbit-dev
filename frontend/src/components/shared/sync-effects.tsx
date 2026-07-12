"use client";

import { useSyncProgress } from "@/lib/hooks";

/**
 * Global side-effect for immediate syncs: when a scan finishes it toasts the
 * outcome once and refetches memory + feed. Renders nothing — progress itself is
 * shown contextually in the Feed's scan surface, not as a banner.
 */
export function SyncEffects() {
  useSyncProgress();
  return null;
}
