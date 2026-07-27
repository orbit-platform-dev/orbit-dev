"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./api";
import type { SyncProgress } from "./types";

export const qk = {
  feed: ["feed"] as const,
  learning: ["learning"] as const,
  artifacts: ["artifacts"] as const,
  entities: ["entities"] as const,
  entity: (id: string) => ["entity", id] as const,
  integrations: ["integrations"] as const,
  heartbeat: ["heartbeat"] as const,
  mcp: ["mcp"] as const,
  credits: ["credits"] as const,
};

export const useFeed = () =>
  useQuery({ queryKey: qk.feed, queryFn: api.getFeed, refetchInterval: 20000 });
export const useLearning = () => useQuery({ queryKey: qk.learning, queryFn: api.getLearning });
export const useArtifacts = () => useQuery({ queryKey: qk.artifacts, queryFn: api.getArtifacts });
export const useEntities = (kind?: string) =>
  useQuery({ queryKey: [...qk.entities, kind ?? "all"], queryFn: () => api.getEntities(kind) });
export const useEntity = (id: string) =>
  useQuery({ queryKey: qk.entity(id), queryFn: () => api.getEntity(id), enabled: !!id });
export const useIntegrations = () =>
  useQuery({ queryKey: qk.integrations, queryFn: api.getIntegrations });
export const useMcpStatus = () => useQuery({ queryKey: qk.mcp, queryFn: api.getMcpStatus });
export const useCredits = () => useQuery({ queryKey: qk.credits, queryFn: api.getCredits });
export const useHeartbeat = () =>
  useQuery({
    queryKey: qk.heartbeat,
    queryFn: api.getHeartbeat,
    // Poll fast while an immediate sync is running so progress feels live.
    refetchInterval: (query) => (query.state.data?.sync?.active ? 1500 : 60_000),
  });

/**
 * The current immediate-sync progress. On the active→finished transition it
 * refetches memory/feed so the new data appears, and toasts the outcome once.
 */
export function useSyncProgress(): SyncProgress | null | undefined {
  const qc = useQueryClient();
  const { data } = useHeartbeat();
  const sync = data?.sync;
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && sync && !sync.active) {
      qc.invalidateQueries({ queryKey: qk.artifacts });
      qc.invalidateQueries({ queryKey: qk.entities });
      qc.invalidateQueries({ queryKey: qk.feed });
      if (sync.phase === "done") toast.success(sync.message);
      else if (sync.phase === "error") toast.error(sync.message);
    }
    wasActive.current = !!sync?.active;
  }, [sync?.active, sync?.phase, sync?.message, qc]);
  return sync;
}
