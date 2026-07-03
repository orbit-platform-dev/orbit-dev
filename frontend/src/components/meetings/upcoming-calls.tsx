"use client";

// "Starting soon" strip for the Meetings page: ONLY calls that are live right
// now or start within the next 30 minutes — everything else lives in Calendar.

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Users } from "lucide-react";
import { useCalendarEvents, useCalendarStatus } from "@/lib/hooks";
import type { CalendarEvent } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import { EventActions } from "@/components/calendar/event-actions";
import { Button } from "@/components/ui/button";

const SOON_MS = 30 * 60_000;

export function UpcomingCalls() {
  const { data: status } = useCalendarStatus();
  const { data: events } = useCalendarEvents(!!status?.connected, undefined, 1);
  // Re-evaluate the 30-minute window as time passes.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!status) return null;

  if (!status.connected) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-4 py-3">
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Connect your calendar and every upcoming meeting becomes an{" "}
          <span className="font-medium text-foreground/90">Orbit call</span> automatically.
        </p>
        <Button size="sm" variant="outline" className="ml-auto shrink-0" asChild>
          <Link href="/calendar">Connect</Link>
        </Button>
      </div>
    );
  }

  const soon = (events ?? []).filter((ev) => {
    if (!ev.start?.includes("T")) return false;
    const start = new Date(ev.start).getTime();
    const end = ev.end ? new Date(ev.end).getTime() : start + SOON_MS;
    return start <= now + SOON_MS && end > now;
  });
  if (soon.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <h2 className="text-sm font-semibold tracking-tight">Starting soon</h2>
        <Link href="/calendar" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
          Open calendar <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {soon.map((ev) => (
          <SoonCard key={ev.id} event={ev} now={now} />
        ))}
      </div>
    </div>
  );
}

function SoonCard({ event: ev, now }: { event: CalendarEvent; now: number }) {
  const start = new Date(ev.start!).getTime();
  const minutes = Math.round((start - now) / 60_000);
  const label = minutes <= 0 ? "Live now" : minutes === 1 ? "in 1 min" : `in ${minutes} min`;

  return (
    <div className="glass flex items-center gap-3 rounded-xl border-primary/25 p-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{ev.title}</span>
          <span className={minutes <= 0
            ? "shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400"
            : "shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"}>
            {label}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatTime(ev.start!)}{ev.end ? ` – ${formatTime(ev.end)}` : ""}</span>
          {ev.attendees.length > 0 && (
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{ev.attendees.length}</span>
          )}
        </div>
      </div>
      <EventActions event={ev} compact />
    </div>
  );
}
