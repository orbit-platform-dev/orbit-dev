"use client";

import { OrbitMark } from "@/components/shared/logo";

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 animate-in fade-in-0 duration-300">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-primary/70 [animation-duration:1.6s]" />
        <div className="absolute inset-2 animate-spin rounded-full border border-transparent border-b-info/50 [animation-direction:reverse] [animation-duration:2.6s]" />
        <OrbitMark className="h-8 w-8 drop-shadow-[0_0_14px_hsl(var(--primary)/0.5)]" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
