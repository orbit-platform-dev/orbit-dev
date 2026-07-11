"use client";

import { useQuery } from "@tanstack/react-query";
import * as api from "./api";

// Keys
export const qk = {
  dashboard: ["dashboard"] as const,
  meetings: ["meetings"] as const,
  meeting: (id: string) => ["meeting", id] as const,
  agents: ["agents"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  tasks: ["tasks"] as const,
  timeline: ["timeline"] as const,
  integrations: ["integrations"] as const,
  activity: ["activity"] as const,
  calendarStatus: ["calendar", "status"] as const,
  calendarEvents: ["calendar", "events"] as const,
  zoomStatus: ["zoom", "status"] as const,
  zoomRecordings: ["zoom", "recordings"] as const,
  meetStatus: ["meet", "status"] as const,
  meetRecordings: ["meet", "recordings"] as const,
  customers: ["customers"] as const,
  customerKnowledge: (id: string) => ["customers", id, "knowledge"] as const,
  syncJobs: (planId: string) => ["sync-jobs", planId] as const,
  insights: ["insights"] as const,
  goals: ["goals"] as const,
  heartbeat: ["heartbeat"] as const,
};

export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: api.getDashboard, refetchInterval: 8000 });
export const useMeetings = () => useQuery({ queryKey: qk.meetings, queryFn: api.getMeetings });
export const useMeeting = (id: string) =>
  useQuery({
    queryKey: qk.meeting(id),
    queryFn: () => api.getMeeting(id),
    enabled: !!id,
    // While a meeting is still being analyzed, poll so its progress climbs live.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && status !== "analyzed" && status !== "failed" ? 2000 : false;
    },
  });
export const useAgents = () => useQuery({ queryKey: qk.agents, queryFn: api.getAgents, refetchInterval: 5000 });
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: api.getProjects });
export const useProject = (id: string) => useQuery({ queryKey: qk.project(id), queryFn: () => api.getProject(id), enabled: !!id });
export const useTasks = () => useQuery({ queryKey: qk.tasks, queryFn: api.getTasks });
export const useTimeline = () => useQuery({ queryKey: qk.timeline, queryFn: api.getTimeline });
export const useIntegrations = () => useQuery({ queryKey: qk.integrations, queryFn: api.getIntegrations });
export const useActivity = () => useQuery({ queryKey: qk.activity, queryFn: api.getActivity, refetchInterval: 10000 });

export const useCalendarStatus = () =>
  useQuery({ queryKey: qk.calendarStatus, queryFn: api.getCalendarStatus });
/** Calendar events in a window; keyed by window so week paging caches per week.
 *  Google is the source of truth, so unlike Orbit-internal queries this refetches
 *  the moment the tab regains focus — edits made in Google Calendar appear (and
 *  auto-link) as soon as the user comes back, no refresh needed. */
export const useCalendarEvents = (connected: boolean, timeMin?: string, days = 7) =>
  useQuery({
    queryKey: [...qk.calendarEvents, timeMin ?? "now", days],
    queryFn: () => api.getCalendarEvents(timeMin, days),
    enabled: connected,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
    placeholderData: (prev) => prev, // keep the grid on screen while refetching
  });

export const useCustomers = () =>
  useQuery({ queryKey: qk.customers, queryFn: api.getCustomers });
export const useCustomer = (id: string) =>
  useQuery({ queryKey: [...qk.customers, id], queryFn: () => api.getCustomer(id), enabled: !!id });
export const useCustomerKnowledge = (id: string) =>
  useQuery({ queryKey: qk.customerKnowledge(id), queryFn: () => api.getCustomerKnowledge(id), enabled: !!id });
export const useInsights = () =>
  useQuery({ queryKey: qk.insights, queryFn: () => api.getInsights() });
export const useGoals = () =>
  useQuery({ queryKey: qk.goals, queryFn: api.getGoals });
export const useHeartbeat = () =>
  useQuery({ queryKey: qk.heartbeat, queryFn: api.getHeartbeat, refetchInterval: 60_000 });
/** Sync jobs for a plan. Jobs run only on explicit user action, so polling is
 *  needed just while one is actually executing. */
export const useSyncJobs = (planId?: string, enabled = true) =>
  useQuery({
    queryKey: qk.syncJobs(planId ?? ""),
    queryFn: () => api.getSyncJobs(planId!),
    enabled: !!planId && enabled,
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === "running") ? 1500 : false,
  });

export const useZoomStatus = () =>
  useQuery({ queryKey: qk.zoomStatus, queryFn: api.getZoomStatus });
export const useZoomRecordings = (enabled: boolean) =>
  useQuery({ queryKey: qk.zoomRecordings, queryFn: api.getZoomRecordings, enabled });
export const useMeetStatus = () =>
  useQuery({ queryKey: qk.meetStatus, queryFn: api.getMeetStatus });
export const useMeetRecordings = (enabled: boolean) =>
  useQuery({ queryKey: qk.meetRecordings, queryFn: api.getMeetRecordings, enabled });

/** The connected issue-tracker push target. Linear is the only real one today. */
export function useConnectedProvider(): "jira" | "linear" | null {
  const { data } = useIntegrations();
  const isUp = (k: string) => data?.some((i) => i.key === k && (i.status === "connected" || i.status === "syncing"));
  if (isUp("linear")) return "linear";
  return null;
}
