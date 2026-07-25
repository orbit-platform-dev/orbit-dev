import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { IntegrationStatus } from "@/lib/types";

type Variant =
  "default" | "secondary" | "outline" | "success" | "warning" | "info" | "destructive" | "muted";

export function StatusDot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            className,
          )}
        />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", className)} />
    </span>
  );
}

const integrationStatusMeta: Record<
  IntegrationStatus,
  { label: string; variant: Variant; dot: string; pulse: boolean }
> = {
  connected: { label: "Connected", variant: "success", dot: "bg-success", pulse: false },
  disconnected: {
    label: "Not connected",
    variant: "muted",
    dot: "bg-muted-foreground",
    pulse: false,
  },
  error: { label: "Action needed", variant: "destructive", dot: "bg-destructive", pulse: false },
  syncing: { label: "Syncing", variant: "info", dot: "bg-info", pulse: true },
  "coming-soon": {
    label: "Coming soon",
    variant: "muted",
    dot: "bg-muted-foreground",
    pulse: false,
  },
  reconnect: { label: "Session expired", variant: "warning", dot: "bg-warning", pulse: false },
};

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  const m = integrationStatusMeta[status];
  return (
    <Badge variant={m.variant}>
      <StatusDot className={m.dot} pulse={m.pulse} />
      {m.label}
    </Badge>
  );
}
