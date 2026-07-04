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
  graph: ["graph"] as const,
  timeline: ["timeline"] as const,
  integrations: ["integrations"] as const,
  activity: ["activity"] as const,
  calendarStatus: ["calendar", "status"] as const,
  calendarEvents: ["calendar", "events"] as const,
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
export const useExecutionGraph = (meetingId?: string) =>
  useQuery({
    queryKey: meetingId ? [...qk.graph, meetingId] : qk.graph,
    queryFn: () => api.getExecutionGraph(meetingId),
    refetchInterval: 6000,
  });
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

/** The connected push target (Jira preferred, then Linear), or null if none. */
export function useConnectedProvider(): "jira" | "linear" | null {
  const { data } = useIntegrations();
  const isUp = (k: string) => data?.some((i) => i.key === k && (i.status === "connected" || i.status === "syncing"));
  if (isUp("jira")) return "jira";
  if (isUp("linear")) return "linear";
  return null;
}
