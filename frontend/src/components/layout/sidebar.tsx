"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { navSections } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { workspace } from "@/lib/auth";
import { OrbitMark } from "@/components/shared/logo";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r border-border/60 bg-card/55 backdrop-blur-xl">
      <div className="px-3 pt-4">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <OrbitMark className="h-8 w-8" />
          <div className="truncate text-sm font-semibold leading-tight">{workspace.name}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="no-scrollbar mt-3 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {navSections.map((section, i) => (
          <div key={i} className="space-y-0.5">
            {section.label ? (
              <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
            ) : null}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 -z-10 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <item.icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
