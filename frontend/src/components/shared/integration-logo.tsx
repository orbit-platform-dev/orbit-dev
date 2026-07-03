import {
  siAsana, siConfluence, siGithub, siGooglecalendar, siGoogledocs, siGooglemeet, siHubspot,
  siIntercom, siJira, siLinear, siNotion, siZoom,
} from "simple-icons";
import type { IntegrationKey } from "@/lib/types";
import { cn } from "@/lib/utils";

type Brand = { path: string; hex: string };

// Real brand marks (simple-icons). Slack / Salesforce / Gong were removed from
// simple-icons for trademark reasons, so they fall back to a monogram tile below.
const ICONS: Partial<Record<IntegrationKey, Brand>> = {
  jira: siJira,
  linear: siLinear,
  github: siGithub,
  notion: siNotion,
  hubspot: siHubspot,
  calendar: siGooglecalendar,
  "google-meet": siGooglemeet,
  zoom: siZoom,
  intercom: siIntercom,
  asana: siAsana,
  confluence: siConfluence,
  "google-docs": siGoogledocs,
};

// Monogram fallback (short label + brand color) for marks not in simple-icons.
export const integrationBrand: Record<IntegrationKey, { short: string; color: string }> = {
  "google-meet": { short: "GM", color: "#00897b" },
  zoom: { short: "Zm", color: "#2d8cff" },
  slack: { short: "Sl", color: "#611f69" },
  github: { short: "Gh", color: "#8b95a5" },
  jira: { short: "Ji", color: "#2684ff" },
  linear: { short: "Li", color: "#5e6ad2" },
  notion: { short: "No", color: "#c9c9c9" },
  hubspot: { short: "Hs", color: "#ff7a59" },
  salesforce: { short: "Sf", color: "#00a1e0" },
  calendar: { short: "Ca", color: "#4285f4" },
  gong: { short: "Go", color: "#a855f7" },
  intercom: { short: "Ic", color: "#1f8ded" },
  asana: { short: "As", color: "#f06a6a" },
  confluence: { short: "Cf", color: "#2684ff" },
  "google-docs": { short: "GD", color: "#4285f4" },
};

export function IntegrationLogo({ k, className }: { k: IntegrationKey; className?: string }) {
  const icon = ICONS[k];
  if (icon) {
    // Real logos sit on a white tile so dark marks (GitHub, Notion) stay crisp on the dark UI.
    return (
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white", className)}>
        <svg role="img" viewBox="0 0 24 24" className="h-1/2 w-1/2" fill={`#${icon.hex}`} xmlns="http://www.w3.org/2000/svg">
          <path d={icon.path} />
        </svg>
      </div>
    );
  }
  const b = integrationBrand[k];
  return (
    <div
      className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold", className)}
      style={{ background: `${b.color}1f`, borderColor: `${b.color}40`, color: b.color }}
    >
      {b.short}
    </div>
  );
}
