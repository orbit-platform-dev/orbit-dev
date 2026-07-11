"use client";

// Orbit Calendar — a Google Calendar-style week grid, themed for Orbit.
// Read-only: events are created in your calendar apps; Orbit only syncs them
// so upcoming customer conversations are visible. ‹ › pages week by week;
// click an event for details.

import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Link2, Loader2,
  RefreshCw, Users,
} from "lucide-react";
import { qk, useCalendarEvents, useCalendarStatus } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { CalendarEvent } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const HOUR_PX = 52;
const DAY_MS = 86_400_000;

// --- Date helpers (all local time — the grid is the user's day) ---------------
const startOfWeek = (d: Date) => {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay()); // Sunday start, like Google
  return s;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const minutesIntoDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

function weekLabel(weekStart: Date): string {
  const end = new Date(weekStart.getTime() + 6 * DAY_MS);
  const m = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  const range = m(weekStart) === m(end)
    ? `${m(weekStart)} ${weekStart.getDate()} – ${end.getDate()}`
    : `${m(weekStart)} ${weekStart.getDate()} – ${m(end)} ${end.getDate()}`;
  return `${range}, ${end.getFullYear()}`;
}

export default function CalendarPage() {
  const qc = useQueryClient();
  const { data: status, isLoading: statusLoading } = useCalendarStatus();
  const [weekOffset, setWeekOffset] = React.useState(0);
  const weekStart = React.useMemo(
    () => new Date(startOfWeek(new Date()).getTime() + weekOffset * 7 * DAY_MS),
    [weekOffset],
  );
  const { data: events, isLoading: eventsLoading, isFetching } =
    useCalendarEvents(!!status?.connected, weekStart.toISOString(), 7);

  // Landing back from Google's consent screen (?calendar=connected|error).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    if (result === "connected") toast.success("Google Calendar connected", { description: "Your upcoming events now sync into Orbit." });
    else toast.error("Google Calendar connection failed", { description: params.get("reason") ?? undefined });
    window.history.replaceState(null, "", "/calendar");
    qc.invalidateQueries({ queryKey: qk.calendarStatus });
    qc.invalidateQueries({ queryKey: qk.integrations });
  }, [qc]);

  if (statusLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96 w-full" /></div>;
  }

  if (!status?.connected) return <ConnectScreen configured={!!status?.configured} />;

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Your upcoming conversations — each can become a signal Orbit reasons over."
      >
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {isFetching ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CalendarDays className="h-3 w-3" />}
          Synced with {status.email}
        </p>
      </PageHeader>

      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
          Today
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="ml-1 text-sm font-semibold tracking-tight">{weekLabel(weekStart)}</h2>
      </div>

      {eventsLoading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : (
        <WeekGrid weekStart={weekStart} events={events ?? []} />
      )}
    </div>
  );
}

// --- Week grid ------------------------------------------------------------------
interface Positioned {
  ev: CalendarEvent;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Interval-partition a day's timed events into lanes so overlaps sit side by side. */
function layoutDay(dayEvents: CalendarEvent[]): Positioned[] {
  const items = dayEvents
    .map((ev) => {
      const s = new Date(ev.start!);
      const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 30 * 60_000);
      const startMin = minutesIntoDay(s);
      const endMin = sameDay(s, e) ? Math.max(startMin + 20, minutesIntoDay(e)) : 24 * 60;
      return { ev, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: Positioned[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const placed = cluster.map((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.startMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.endMin;
      return { ...it, lane };
    });
    for (const p of placed) {
      out.push({
        ev: p.ev,
        top: (p.startMin / 60) * HOUR_PX,
        height: Math.max(26, ((p.endMin - p.startMin) / 60) * HOUR_PX - 2),
        lane: p.lane,
        lanes: laneEnds.length,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

function WeekGrid({ weekStart, events }: { weekStart: Date; events: CalendarEvent[] }) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS));

  const { timedByDay, allDayByDay } = React.useMemo(() => {
    const timed = new Map<string, CalendarEvent[]>();
    const allDay = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!ev.start) continue;
      const isTimed = ev.start.includes("T");
      const key = new Date(ev.start).toDateString();
      const bucket = isTimed ? timed : allDay;
      bucket.set(key, [...(bucket.get(key) ?? []), ev]);
    }
    return { timedByDay: timed, allDayByDay: allDay };
  }, [events]);

  // Open on “the working day”: current time when today is visible, else 8 AM.
  React.useEffect(() => {
    const visibleToday = days.some((d) => sameDay(d, today));
    const target = visibleToday ? Math.max(0, (minutesIntoDay(today) / 60 - 1.5) * HOUR_PX) : 8 * HOUR_PX;
    scrollRef.current?.scrollTo({ top: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getTime()]);

  const hasAllDay = days.some((d) => allDayByDay.get(d.toDateString())?.length);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Day header */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
        <div />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          return (
            <div key={d.toISOString()} className="border-l border-border/60 py-2 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div
                className={cn(
                  "mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                  isToday ? "bg-primary text-primary-foreground" : "text-foreground/90",
                )}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border/60">
          <div className="py-1 pr-2 text-right text-[9px] uppercase text-muted-foreground/70">all day</div>
          {days.map((d) => (
            <div key={d.toISOString()} className="space-y-0.5 border-l border-border/60 p-1">
              {(allDayByDay.get(d.toDateString()) ?? []).map((ev) => (
                <EventPopover key={ev.id} event={ev}>
                  <button className="w-full truncate rounded bg-secondary px-1.5 py-0.5 text-left text-[11px] text-foreground/80 hover:bg-accent">
                    {ev.title}
                  </button>
                </EventPopover>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Time grid */}
      <div ref={scrollRef} className="h-[62vh] min-h-[420px] overflow-y-auto">
        <div className="relative grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: 24 * HOUR_PX }}>
          {/* Hour gutter */}
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted-foreground/70"
                style={{ top: h * HOUR_PX }}
              >
                {h % 12 === 0 ? 12 : h % 12} {h < 12 ? "AM" : "PM"}
              </span>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const isToday = sameDay(d, today);
            return (
              <div key={d.toISOString()} className={cn("relative border-l border-border/60", isToday && "bg-primary/[0.03]")}>
                {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/40" style={{ top: h * HOUR_PX }} />
                ))}
                {layoutDay(timedByDay.get(d.toDateString()) ?? []).map((p) => (
                  <EventBlock key={p.ev.id} p={p} />
                ))}
                {isToday && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NowLine() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const top = (minutesIntoDay(now) / 60) * HOUR_PX;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="relative border-t-2 border-red-500">
        <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
      </div>
    </div>
  );
}

function EventBlock({ p }: { p: Positioned }) {
  const { ev } = p;
  const width = 100 / p.lanes;
  return (
    <EventPopover event={ev}>
      <button
        className="absolute z-10 overflow-hidden rounded-md border-l-2 border-primary bg-primary/15 px-1.5 py-1 text-left transition-colors hover:bg-primary/25"
        style={{
          top: p.top,
          height: p.height,
          left: `calc(${p.lane * width}% + 2px)`,
          width: `calc(${width}% - 4px)`,
        }}
      >
        <div className="truncate text-[11px] font-semibold leading-tight text-primary">
          {ev.title}
        </div>
        {p.height >= 40 && ev.start && (
          <div className="truncate text-[10px] text-muted-foreground">
            {formatTime(ev.start)}{ev.end ? ` – ${formatTime(ev.end)}` : ""}
          </div>
        )}
      </button>
    </EventPopover>
  );
}

function EventPopover({ event: ev, children }: { event: CalendarEvent; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="start">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug">{ev.title}</h3>
          {ev.htmlLink && (
            <a href={ev.htmlLink} target="_blank" rel="noreferrer" aria-label="Open in Google Calendar"
              className="shrink-0 text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {ev.start && (
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(ev.start).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            {ev.start.includes("T") && <> · {formatTime(ev.start)}{ev.end ? ` – ${formatTime(ev.end)}` : ""}</>}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {ev.meetLink && <Badge variant="muted">Meet</Badge>}
          {ev.attendees.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Users className="h-3 w-3" />{ev.attendees.length}
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Connect screen (nothing connected yet) ----------------------------------
function ConnectScreen({ configured }: { configured: boolean }) {
  const [connecting, setConnecting] = React.useState<"google" | "zoom" | null>(null);
  const connect = async (provider: "google" | "zoom") => {
    setConnecting(provider);
    try {
      const { url } = await (provider === "google" ? api.getCalendarAuthUrl() : api.getZoomAuthUrl());
      window.location.href = url;
    } catch (err) {
      toast.error(`${provider === "google" ? "Google Calendar" : "Zoom"} isn't configured`, { description: (err as Error).message });
      setConnecting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Connect a calendar to see your upcoming customer conversations — each can become a signal Orbit reasons over."
      />
      <div className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <IntegrationLogo k="calendar" className="h-12 w-12 text-base" />
          <h2 className="mt-4 text-base font-semibold">Google Calendar</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Syncs your upcoming events into Orbit — read-only, your calendar stays the source of truth.
          </p>
          <Button className="mt-5 w-full gap-2" onClick={() => connect("google")} disabled={connecting !== null}>
            {connecting === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Connect Google Calendar
          </Button>
          {!configured && (
            <p className="mt-3 text-xs leading-relaxed text-warning">
              Backend isn&apos;t configured yet — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env first.
            </p>
          )}
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-border bg-card/60 p-8 text-center">
          <IntegrationLogo k="zoom" className="h-12 w-12 text-base" />
          <h2 className="mt-4 text-base font-semibold">Zoom</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Import cloud-recording transcripts as signals — analyzed like every other conversation.
          </p>
          <Button variant="outline" className="mt-5 w-full gap-2" onClick={() => connect("zoom")} disabled={connecting !== null}>
            {connecting === "zoom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Connect Zoom
          </Button>
        </div>
      </div>
    </div>
  );
}

