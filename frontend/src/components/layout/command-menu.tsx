"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { allNavItems } from "@/lib/nav";

export const OPEN_COMMAND_EVENT = "orbit:command-open";

export function CommandMenu() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (e.key === "/" && (e.target as HTMLElement)?.tagName === "INPUT") return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener(OPEN_COMMAND_EVENT, openHandler);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_COMMAND_EVENT, openHandler);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Jump to…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">ESC</kbd>
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">No results found.</Command.Empty>
            <Command.Group heading="Navigate">
              {allNavItems.map((item) => (
                <Item key={item.href} onSelect={() => go(item.href)} icon={<item.icon className="h-4 w-4" />}>
                  {item.label}
                </Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> to select
            </span>
            <span>Orbit Command</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Item({
  children,
  icon,
  onSelect,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/90 outline-none data-[selected=true]:bg-accent data-[selected=true]:text-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-data-[selected=true]:opacity-60" />
    </Command.Item>
  );
}
