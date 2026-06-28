import { cn } from "@/lib/utils";

export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("h-7 w-7", className)} aria-hidden>
      <defs>
        <linearGradient id="orbitGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5982ff" />
          <stop offset="1" stopColor="#1f3ce0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#orbitGrad)" />
      <circle cx="16" cy="16" r="3.2" fill="white" />
      <ellipse cx="16" cy="16" rx="9.5" ry="4.4" stroke="white" strokeOpacity="0.9" strokeWidth="1.4" transform="rotate(30 16 16)" />
      <circle cx="24" cy="11.2" r="1.7" fill="white" />
    </svg>
  );
}

export function OrbitWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <OrbitMark />
      <span className="text-[15px] font-semibold tracking-tight">Orbit</span>
    </div>
  );
}
