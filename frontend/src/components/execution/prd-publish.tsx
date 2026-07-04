"use client";


import { Share2 } from "lucide-react";
import type { ProjectPRD } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PublishDialog } from "./publish-dialog";
import { PUBLISH_DESTINATIONS, destinationName, publishPrdTo, type PublishOutcome } from "./publish-destinations";

export function PrdPublish({ projectId, prd, projectName, onChanged }: {
  projectId: string; prd: ProjectPRD; projectName: string; onChanged: () => void;
}) {
  const initialLinks: PublishOutcome[] = prd.publication
    ? [{ key: prd.publication.tool, name: destinationName(prd.publication.tool), url: prd.publication.url }]
    : [];

  return (
    <PublishDialog
      trigger={<Button size="sm" variant="outline" className="gap-1.5"><Share2 className="h-3.5 w-3.5" /> Publish</Button>}
      title="Where should Orbit send this PRD?"
      description="Pick one or more destinations. PDF is always available."
      destinations={PUBLISH_DESTINATIONS}
      publish={(d) => publishPrdTo(d, { projectId, prd, projectName })}
      onDone={onChanged}
      initialLinks={initialLinks}
    />
  );
}
