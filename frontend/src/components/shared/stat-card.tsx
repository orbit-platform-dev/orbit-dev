import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "./sparkline";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  delta,
  spark,
  hint,
  positiveIsGood = true,
  color,
}: {
  label: string;
  value: string;
  delta?: number;
  spark?: number[];
  hint?: string;
  positiveIsGood?: boolean;
  color?: string;
}) {
  const up = (delta ?? 0) >= 0;
  const good = positiveIsGood ? up : !up;
  return (
    <Card className="overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="text-gradient mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        </div>
        {typeof delta === "number" && (
          <div className={cn("flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium", good ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta)}%
          </div>
        )}
      </div>
      {spark ? (
        <div className="mt-3 -mb-1">
          <Sparkline data={spark} color={color ?? (good ? "hsl(var(--success))" : "hsl(var(--primary))")} height={36} />
        </div>
      ) : hint ? (
        <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </Card>
  );
}
