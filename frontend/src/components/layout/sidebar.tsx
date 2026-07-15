"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navSections } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { OrbitMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";

const COLLAPSE_KEY = "orbit-sidebar-collapsed";

export function Sidebar({ onNavigate, collapsible = true }: { onNavigate?: () => void; collapsible?: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    if (collapsible) setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, [collapsible]);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  // ⌘B / Ctrl+B, the muscle-memory shortcut for the sidebar.
  React.useEffect(() => {
    if (!collapsible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsible, toggle]);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-border/60 bg-card/55 backdrop-blur-xl transition-[width] duration-200",
        collapsed ? "w-[4.25rem]" : "w-64",
      )}
    >
      <div className={cn("pt-4", collapsed ? "px-2.5" : "px-3")}>
        <div className={cn("flex items-center py-2", collapsed ? "justify-center px-0" : "gap-2.5 px-2")}>
          <OrbitMark className="h-8 w-8 shrink-0" />
          {!collapsed && <div className="flex-1 truncate text-sm font-semibold leading-tight">Orbit</div>}
          {collapsible && !collapsed && (
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Collapse sidebar" title="Collapse (⌘B)"
                    className="text-muted-foreground hover:text-foreground">
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
        {collapsible && collapsed && (
          <div className="flex justify-center pt-1">
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Expand sidebar" title="Expand (⌘B)"
                    className="text-muted-foreground hover:text-foreground">
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <nav className={cn("no-scrollbar mt-3 flex-1 space-y-5 overflow-y-auto pb-4", collapsed ? "px-2.5" : "px-3")}>
        {navSections.map((section, i) => (
          <div key={i} className="space-y-0.5">
            {section.label && !collapsed ? (
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
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "gap-2.5 px-2",
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
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
