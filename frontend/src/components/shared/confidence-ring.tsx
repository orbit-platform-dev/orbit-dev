import { cn } from "@/lib/utils";

export function ConfidenceRing({
  value,
  size = 56,
  stroke = 5,
  color = "hsl(var(--primary))",
  label,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold tabular-nums leading-none">{value}</span>
        {label ? <span className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}
