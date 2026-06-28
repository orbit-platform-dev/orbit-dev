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
};

export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: api.getDashboard, refetchInterval: 8000 });
export const useMeetings = () => useQuery({ queryKey: qk.meetings, queryFn: api.getMeetings });
export const useMeeting = (id: string) => useQuery({ queryKey: qk.meeting(id), queryFn: () => api.getMeeting(id), enabled: !!id });
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
