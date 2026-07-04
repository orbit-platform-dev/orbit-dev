import { cn } from "@/lib/utils";

type Props ={
  className?:string
}

export function OrbitMark({ className }: Props) {
  return (
    <span className={cn("inline-block h-7 w-7 shrink-0 overflow-hidden rounded-full", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/orbit-logo.svg" alt="Orbit" className="h-full w-full scale-125 object-cover" />
    </span>
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
