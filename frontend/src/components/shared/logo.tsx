import { cn } from "@/lib/utils";
import { OrbitLogo } from "./orbit-mark";

// The official mark is a transparent inline SVG (see ./orbit-mark.tsx), used
// exactly as the landing page uses it — no background-cropping tricks needed.
export function OrbitMark({ className }: { className?: string }) {
  return <OrbitLogo className={cn("h-7 w-7 shrink-0", className)} />;
}

export function OrbitWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <OrbitMark />
      <span className="text-[15px] font-semibold tracking-tight">Orbit</span>
    </div>
  );
}
