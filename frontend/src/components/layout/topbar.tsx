"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Menu, Moon, Search, Settings, Sun, User } from "lucide-react";
import { useUser, useClerk, useOrganization } from "@clerk/nextjs";
import { allNavItems } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { OrbitWordmark } from "@/components/shared/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sidebar } from "./sidebar";
import { SyncControl } from "./sync-control";
import { OPEN_COMMAND_EVENT } from "./command-menu";

function useBreadcrumb() {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean)[0] ?? "feed";
  const item = allNavItems.find((i) => i.href === `/${seg}`);
  return item?.label ?? seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function Topbar() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const crumb = useBreadcrumb();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { organization } = useOrganization();

  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  // Everyone belongs to exactly one workspace (Orbit for the team, their own for
  // a customer). There is no switching, so we just show its name.
  const workspaceName = organization?.name ?? "Workspace";

  const openCommand = () => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>

      {/* Brand on mobile (the sidebar carries it on desktop). */}
      <div className="lg:hidden">
        <OrbitWordmark />
      </div>

      {/* Desktop: the workspace is small context; the Orbit brand lives in the sidebar. */}
      <div className="hidden items-center gap-2 text-sm lg:flex">
        <span className="max-w-[180px] truncate text-muted-foreground">{workspaceName}</span>
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
        <SyncControl />
        <div className="mx-1 hidden h-5 w-px bg-border md:block" />
        <Button variant="ghost" size="icon-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
          <Sun className="hidden h-4 w-4 dark:block" />
          <Moon className="block h-4 w-4 dark:hidden" />
        </Button>

        {/* User menu — Orbit's own control, backed by the Clerk session. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full outline-none ring-ring focus-visible:ring-2">
              <UserAvatar name={name} className="h-8 w-8" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <UserAvatar name={name} className="h-9 w-9" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                {email ? <div className="truncate text-xs text-muted-foreground">{email}</div> : null}
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
            <DropdownMenuItem onClick={() => signOut({ redirectUrl: "/sign-in" })}>
              <LogOut className="h-4 w-4" />Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile sidebar */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="left-0 top-0 h-full max-w-[17rem] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} collapsible={false} />
        </DialogContent>
      </Dialog>
    </header>
  );
}
