"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import { useExecutionGraph, useMeetings } from "@/lib/hooks";

function GraphInner() {
  const params = useSearchParams();
  const { data: meetings } = useMeetings();
  // Only meetings that produced a graph (had real signals) are selectable.
  const withGraph = React.useMemo(
    () => (meetings ?? []).filter((m) => m.status === "analyzed" && m.linkedProjectId),
    [meetings],
  );
  const [meetingId, setMeetingId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const fromUrl = params.get("meeting") ?? undefined;
    if (fromUrl && withGraph.some((m) => m.id === fromUrl)) {
      setMeetingId(fromUrl);
    } else if (!meetingId && withGraph.length) {
      setMeetingId(withGraph[0].id);
    }
  }, [params, withGraph, meetingId]);

  const { data } = useExecutionGraph(meetingId);
  const stages = data?.nodes.length ?? 0;
  const selected = withGraph.find((m) => m.id === meetingId);

  if (!withGraph.length) {
    return (
      <div>
        <PageHeader
          title={<span className="flex items-center gap-2"><Workflow className="h-6 w-6 text-primary" /> Execution Graph</span>}
          description="The execution graph generated from one meeting."
        />
        <EmptyState
          icon={Workflow}
          title="No execution graph yet"
          description="Analyze a meeting transcript with real signals, then open it here to see its Meeting → PRD → Engineering/Design/QA/Sales → Follow-up flow."
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title={<span className="flex items-center gap-2"><Workflow className="h-6 w-6 text-primary" /> Execution Graph</span>}
        description={selected ? `Breakdown of "${selected.title}" — one meeting, end to end.` : "The execution graph for one meeting."}
        actions={
          <div className="flex items-center gap-2">
            <Select value={meetingId} onValueChange={setMeetingId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a meeting" /></SelectTrigger>
              <SelectContent>
                {withGraph.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="success" className="hidden sm:inline-flex">{stages} stages</Badge>
          </div>
        }
      />
      <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-card/30">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" />
        <GraphCanvas meetingId={meetingId} />
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <GraphInner />
    </Suspense>
  );
}
