"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  User,
} from "lucide-react";
import { allNavItems } from "@/lib/nav";
import { demoUser, workspace } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sidebar } from "./sidebar";
import { OPEN_COMMAND_EVENT } from "./command-menu";
import { useActivity } from "@/lib/hooks";

function useBreadcrumb() {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const item = allNavItems.find((i) => i.href === `/${seg}`);
  return item?.label ?? seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function Topbar() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const crumb = useBreadcrumb();
  const { data: activity } = useActivity();

  const openCommand = () => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>

      <div className="hidden items-center gap-2 text-sm lg:flex">
        <span className="text-muted-foreground">{workspace.name}</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium">{crumb}</span>
      </div>

      {/* Search trigger */}
      <button
        onClick={openCommand}
        className="ml-auto flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-card/40 px-3 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-card/70 lg:ml-4 lg:mr-auto lg:max-w-sm"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
      </button>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
          <Sun className="hidden h-4 w-4 dark:block" />
          <Moon className="block h-4 w-4 dark:hidden" />
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between text-sm font-semibold text-foreground">
              Notifications
              <Badge variant="muted">{activity?.length ?? 0}</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="max-h-80 overflow-y-auto">
              {(activity ?? []).slice(0, 6).map((a) => (
                <DropdownMenuItem key={a.id} className="flex-col items-start gap-0.5 py-2">
                  <div className="text-sm">
                    <span className="font-medium">{a.actor.name}</span>{" "}
                    <span className="text-muted-foreground">{a.action}</span>{" "}
                    <span className="font-medium">{a.target}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{timeAgo(a.at)}</div>
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/activity" className="justify-center text-sm">View all activity</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full outline-none ring-ring focus-visible:ring-2">
              <UserAvatar name={demoUser.name} className="h-8 w-8" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <UserAvatar name={demoUser.name} className="h-9 w-9" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{demoUser.name}</div>
                <div className="truncate text-xs text-muted-foreground">{demoUser.email}</div>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings"><User className="h-4 w-4" />Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings"><Settings className="h-4 w-4" />Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/sign-in"><LogOut className="h-4 w-4" />Sign out</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile sidebar */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="left-0 top-0 h-full max-w-[17rem] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
    </header>
  );
}
