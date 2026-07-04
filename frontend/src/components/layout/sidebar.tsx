"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Sparkles } from "lucide-react";
import { navSections } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { workspace } from "@/lib/auth";
import { OrbitMark } from "@/components/shared/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMeetings } from "@/lib/hooks";

function useBadgeCounts() {
  const { data: meetings } = useMeetings();
  return {
    meetings: meetings?.filter((m) => m.status !== "analyzed").length,
  };
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const counts = useBadgeCounts();

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card/40">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <OrbitMark className="h-8 w-8" />
          <div className="truncate text-sm font-semibold leading-tight">{workspace.name}</div>
        </div>
      </div>

      {/* New meeting CTA */}
      <div className="px-3 pb-1 pt-3">
        <Button asChild className="w-full justify-start gap-2" size="sm">
          <Link href="/meetings?upload=1" onClick={onNavigate}>
            <Plus className="h-4 w-4" />
            New meeting
          </Link>
        </Button>
      </div>

      {/* Nav */}
      <nav className="no-scrollbar mt-2 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {navSections.map((section, i) => (
          <div key={i} className="space-y-0.5">
            {section.label ? (
              <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
            ) : null}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const count = item.badgeKey ? counts[item.badgeKey] : undefined;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 -z-10 rounded-lg bg-secondary"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <item.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                  <span className="flex-1">{item.label}</span>
                  {count ? (
                    <Badge variant="muted" className="px-1.5 py-0 tabular-nums">
                      {count}
                    </Badge>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: ask the agent */}
      <div className="border-t border-border p-3">
        <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2 text-muted-foreground">
          <Link href="/chat" onClick={onNavigate}>
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="flex-1 text-left">Ask Orbit</span>
            <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
              Soon
            </Badge>
          </Link>
        </Button>
      </div>
    </div>
  );
}
