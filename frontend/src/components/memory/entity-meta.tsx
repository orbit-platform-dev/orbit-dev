import { ArrowUpRight, Building2, Handshake, Lightbulb, Target, User, type LucideIcon } from "lucide-react";
import type { Entity } from "@/lib/types";

// Shared presentation for company-model entities, reused by the Memory list and
// the entity detail page so the two never drift.
export const ENTITY_META: Record<string, { label: string; plural: string; icon: LucideIcon }> = {
  customer: { label: "Customer", plural: "Customers", icon: Building2 },
  commitment: { label: "Commitment", plural: "Commitments", icon: Handshake },
  feature: { label: "Request", plural: "Requests", icon: Lightbulb },
  person: { label: "Person", plural: "People", icon: User },
  goal: { label: "Goal", plural: "Goals", icon: Target },
};

export function entityMeta(kind: string) {
  return ENTITY_META[kind] ?? { label: kind, plural: kind, icon: Lightbulb };
}

// Human-readable link relationship labels.
export const LINK_LABEL: Record<string, string> = {
  made_to: "Made to",
  requested_by: "Requested by",
  fulfills: "Fulfilled by",
  source_of: "From",
  mentions: "Mentions",
  relates_to: "Related to",
};

/** Tracked (with the Linear ref) vs untracked, for commitments only. */
export function CommitmentStatusChip({ entity }: { entity: Entity }) {
  if (entity.kind !== "commitment") return null;
  const lin = entity.meta?.linear;
  const tracked = entity.state === "tracked" || entity.state === "delivered";
  if (tracked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
        Tracked
        {lin?.identifier ? (
          lin.url ? (
            <span
              role="link"
              tabIndex={0}
              className="inline-flex cursor-pointer items-center gap-0.5 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(lin.url, "_blank", "noopener,noreferrer");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(lin.url, "_blank", "noopener,noreferrer");
                }
              }}
            >
              {lin.identifier} <ArrowUpRight className="h-3 w-3" />
            </span>
          ) : (
            <span>{lin.identifier}</span>
          )
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
      Untracked
    </span>
  );
}
