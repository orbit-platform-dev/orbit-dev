import type { IntegrationKey } from "@/lib/types";
import { cn } from "@/lib/utils";

export const integrationBrand: Record<IntegrationKey, { short: string; color: string }> = {
  "google-meet": { short: "GM", color: "#00ac47" },
  zoom: { short: "Zm", color: "#2d8cff" },
  slack: { short: "Sl", color: "#611f69" },
  github: { short: "Gh", color: "#8b95a5" },
  jira: { short: "Ji", color: "#2684ff" },
  linear: { short: "Li", color: "#5e6ad2" },
  notion: { short: "No", color: "#c9c9c9" },
  hubspot: { short: "Hs", color: "#ff7a59" },
  salesforce: { short: "Sf", color: "#00a1e0" },
  calendar: { short: "Ca", color: "#4285f4" },
};

export function IntegrationLogo({ k, className }: { k: IntegrationKey; className?: string }) {
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
