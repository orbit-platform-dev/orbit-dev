"use client";

import "@xyflow/react/dist/style.css";
import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { AnimatePresence } from "framer-motion";
import { Filter, Locate, Radio, Search } from "lucide-react";
import type { ExecutionNode, GraphNodeKind, GraphNodeStatus } from "@/lib/types";
import { useExecutionGraph } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { graphStatusMeta } from "@/components/shared/status";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecutionFlowNode, type FlowNodeData } from "./execution-node";
import { NodeDetail } from "./node-detail";
import { kindMeta, kindPositions } from "./graph-meta";

const nodeTypes = { execution: ExecutionFlowNode };
const ALL_STATUSES: GraphNodeStatus[] = ["completed", "active", "pending", "blocked"];

function edgeStyle(animated: boolean): Partial<Edge> {
  return {
    type: "smoothstep",
    animated,
    style: { stroke: animated ? "hsl(var(--primary))" : "hsl(var(--border))", strokeWidth: animated ? 2 : 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: animated ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", width: 16, height: 16 },
  };
}

function Canvas({ meetingId }: { meetingId?: string }) {
  const { data, isLoading } = useExecutionGraph(meetingId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<Set<GraphNodeStatus>>(new Set(ALL_STATUSES));
  const [kindFilter, setKindFilter] = React.useState<Set<GraphNodeKind>>(new Set(Object.keys(kindMeta) as GraphNodeKind[]));
  const seeded = React.useRef(false);
  const { setCenter, fitView } = useReactFlow();

  // Seed nodes/edges once from data.
  React.useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setNodes(
      data.nodes.map((n) => ({
        id: n.id,
        type: "execution",
        position: kindPositions[n.kind] ?? { x: 0, y: 0 },
        data: n as unknown as Record<string, unknown>,
      })),
    );
    setEdges(data.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, ...edgeStyle(e.animated) })));
  }, [data, setNodes, setEdges]);

  // Live progress simulation on active nodes.
  React.useEffect(() => {
    const t = setInterval(() => {
      setNodes((nds) =>
        nds.map((n) => {
          const d = n.data as unknown as FlowNodeData;
          if (d.status === "active" && d.progress < 96) {
            return { ...n, data: { ...d, progress: Math.min(96, d.progress + Math.ceil(Math.random() * 3)) } as unknown as Record<string, unknown> };
          }
          return n;
        }),
      );
    }, 2600);
    return () => clearInterval(t);
  }, [setNodes]);

  // Apply filters + search dimming.
  React.useEffect(() => {
    const q = search.trim().toLowerCase();
    setNodes((nds) =>
      nds.map((n) => {
        const d = n.data as unknown as FlowNodeData;
        const passStatus = statusFilter.has(d.status);
        const passKind = kindFilter.has(d.kind);
        const passSearch = !q || d.title.toLowerCase().includes(q) || d.subtitle.toLowerCase().includes(q);
        const dimmed = !(passStatus && passKind && passSearch);
        if (d.dimmed === dimmed) return n;
        return { ...n, data: { ...d, dimmed } as unknown as Record<string, unknown> };
      }),
    );
  }, [search, statusFilter, kindFilter, setNodes]);

  const selectedNode = React.useMemo(() => {
    const n = nodes.find((x) => x.id === selectedId);
    return n ? (n.data as unknown as ExecutionNode) : null;
  }, [nodes, selectedId]);

  const onNodeClick = React.useCallback((_: React.MouseEvent, n: Node) => setSelectedId(n.id), []);

  // Jump to first search match.
  React.useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = nodes.find((n) => (n.data as unknown as FlowNodeData).title.toLowerCase().includes(q));
    if (match) {
      const t = setTimeout(() => setCenter(match.position.x + 120, match.position.y + 70, { zoom: 1.1, duration: 600 }), 250);
      return () => clearTimeout(t);
    }
  }, [search, nodes, setCenter]);

  const toggle = <T,>(set: Set<T>, val: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setter(next);
  };

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Skeleton className="h-10 w-10 rounded-full" />
          <span className="text-sm">Loading execution graph…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* Toolbar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 p-3">
        <div className="pointer-events-auto relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes…"
            className="h-9 w-56 bg-card/80 pl-8 backdrop-blur"
          />
        </div>

        {/* Status filter chips */}
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card/80 p-1 backdrop-blur">
          {ALL_STATUSES.map((s) => {
            const active = statusFilter.has(s);
            return (
              <button
                key={s}
                onClick={() => toggle(statusFilter, s, setStatusFilter)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: graphStatusMeta[s].color }} />
                {s}
              </button>
            );
          })}
        </div>

        {/* Kind filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="pointer-events-auto gap-1.5 bg-card/80 backdrop-blur">
              <Filter className="h-3.5 w-3.5" /> Stages
              <Badge variant="muted" className="ml-0.5">{kindFilter.size}</Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Filter by stage</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(kindMeta) as GraphNodeKind[]).map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox checked={kindFilter.has(k)} onCheckedChange={() => toggle(kindFilter, k, setKindFilter)} />
                <span className="h-2 w-2 rounded-full" style={{ background: kindMeta[k].color }} />
                {kindMeta[k].label}
              </label>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" className="pointer-events-auto gap-1.5 bg-card/80 backdrop-blur" onClick={() => fitView({ duration: 600, padding: 0.2 })}>
          <Locate className="h-3.5 w-3.5" /> Fit
        </Button>

        <div className="pointer-events-auto ml-auto flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-xs font-medium backdrop-blur">
          <Radio className="h-3.5 w-3.5 text-success animate-pulse" />
          Live
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedId(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
        <Controls showInteractive={false} className="!bottom-3 !left-3" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => graphStatusMeta[(n.data as unknown as FlowNodeData).status].color}
          nodeStrokeWidth={0}
          maskColor="hsl(var(--background) / 0.7)"
          className="!bottom-3 !right-3 hidden sm:block"
        />
      </ReactFlow>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card/80 px-3 py-1.5 text-xs backdrop-blur md:flex">
        {ALL_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 capitalize text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: graphStatusMeta[s].color }} />
            {s}
          </span>
        ))}
      </div>

      <AnimatePresence>
        {selectedNode && <NodeDetail node={selectedNode} onClose={() => setSelectedId(null)} />}
      </AnimatePresence>
    </div>
  );
}

export function GraphCanvas({ meetingId }: { meetingId?: string }) {
  return (
    <ReactFlowProvider>
      <Canvas key={meetingId ?? "all"} meetingId={meetingId} />
    </ReactFlowProvider>
  );
}
