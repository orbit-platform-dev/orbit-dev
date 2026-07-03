import type { Integration } from "@/lib/types";
import { ago, days, hours, mins } from "./time";

export const integrations: Integration[] = [
  { key: "google-meet", name: "Google Meet", category: "Conferencing", description: "Auto-import meeting recordings and transcripts.", status: "connected", lastSync: ago(mins(34)), account: "workspace@orbit.app", stats: [{ label: "Meetings synced", value: "128" }, { label: "This week", value: "9" }] },
  { key: "zoom", name: "Zoom", category: "Conferencing", description: "Pull cloud recordings the moment a call ends.", status: "connected", lastSync: ago(mins(12)), account: "orbit-app", stats: [{ label: "Meetings synced", value: "214" }, { label: "This week", value: "14" }] },
  { key: "slack", name: "Slack", category: "Communication", description: "Post analysis summaries and follow-ups to channels.", status: "connected", lastSync: ago(mins(4)), account: "orbit.slack.com", stats: [{ label: "Channels", value: "6" }, { label: "Messages sent", value: "342" }] },
  { key: "github", name: "GitHub", category: "Engineering", description: "Sync engineering tasks to issues and link PRs.", status: "connected", lastSync: ago(hours(1)), account: "orbit-labs", stats: [{ label: "Issues linked", value: "47" }, { label: "Repos", value: "3" }] },
  { key: "linear", name: "Linear", category: "Engineering", description: "Two-way sync of tasks, status and assignees.", status: "syncing", lastSync: ago(mins(1)), account: "orbit", stats: [{ label: "Issues synced", value: "89" }] },
  { key: "jira", name: "Jira", category: "Engineering", description: "Push generated tasks into Jira projects.", status: "disconnected" },
  { key: "notion", name: "Notion", category: "Product", description: "Publish PRDs and specs to your Notion workspace.", status: "connected", lastSync: ago(hours(3)), account: "Orbit", stats: [{ label: "Docs published", value: "23" }] },
  { key: "hubspot", name: "HubSpot", category: "CRM", description: "Sync accounts, deals and meeting signals to HubSpot.", status: "error", lastSync: ago(days(2)), account: "orbit", stats: [{ label: "Deals", value: "—" }] },
  { key: "salesforce", name: "Salesforce", category: "CRM", description: "Map revenue opportunities to Salesforce pipeline.", status: "disconnected" },
  { key: "calendar", name: "Google Calendar", category: "Calendar", description: "Schedule follow-ups and detect upcoming customer calls.", status: "connected", lastSync: ago(mins(20)), account: "workspace@orbit.app", stats: [{ label: "Events", value: "31" }, { label: "Follow-ups", value: "5" }] },
  { key: "google-docs", name: "Google Docs", category: "Product", description: "Publish approved PRDs to a Google Doc your team can comment on.", status: "connected", lastSync: ago(hours(2)), account: "workspace@orbit.app", stats: [{ label: "Docs published", value: "12" }] },
  { key: "confluence", name: "Confluence", category: "Product", description: "Publish approved PRDs to a Confluence space.", status: "disconnected" },
];
