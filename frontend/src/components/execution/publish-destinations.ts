// Where a PRD can be published, and the service that performs it. Keeping the
// destination list + publish logic here (separate from the dialog UI) means real
// integrations can be added later by only changing `api.publishPrd`/this file —
// the dialog never changes. PDF is a first-class destination, not an integration.

import type { IntegrationKey, ProjectPRD } from "@/lib/types";
import * as api from "@/lib/api";
import { downloadPrdPdf } from "./prd-pdf";

export interface PrdDestination {
  key: string; // "pdf" or an integration key
  name: string;
  integrationKey: IntegrationKey | null; // null = not an integration (PDF), always available
}

// Order per product spec: PDF first (always available), then the doc tools.
export const PUBLISH_DESTINATIONS: PrdDestination[] = [
  { key: "pdf", name: "PDF", integrationKey: null },
  { key: "notion", name: "Notion", integrationKey: "notion" },
  { key: "confluence", name: "Confluence", integrationKey: "confluence" },
  { key: "google-docs", name: "Google Docs", integrationKey: "google-docs" },
  { key: "jira", name: "Jira", integrationKey: "jira" },
  { key: "linear", name: "Linear", integrationKey: "linear" },
];

export function destinationName(key: string): string {
  return PUBLISH_DESTINATIONS.find((d) => d.key === key || d.integrationKey === key)?.name ?? "tool";
}

export interface PublishContext {
  projectId: string;
  prd: ProjectPRD;
  projectName: string;
}

/** One destination's result. `url` is set for integrations (a deep link to the created doc). */
export interface PublishOutcome {
  key: string;
  name: string;
  url?: string;
}

/** Publish a PRD to one destination. PDF downloads locally; integrations go through
 *  api.publishPrd (stubbed today, real create-document call later). */
export async function publishPrdTo(dest: PrdDestination, ctx: PublishContext): Promise<PublishOutcome> {
  if (dest.integrationKey === null) {
    await downloadPrdPdf(ctx.prd, ctx.projectName);
    return { key: dest.key, name: dest.name };
  }
  const res = await api.publishPrd(ctx.projectId, dest.integrationKey);
  return { key: dest.key, name: dest.name, url: res.url };
}
