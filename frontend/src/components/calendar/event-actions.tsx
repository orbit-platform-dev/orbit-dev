"use client";

// The one implementation of calendar-event actions (Join / copy / manual link),
// shared by the Calendar agenda and the Meetings "Next calls" strip.

import * as React from "react";
import Link from "next/link";
import { Check, Copy, Link2, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { CalendarEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EventActions({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  const qc = useQueryClient();
  const [linking, setLinking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const btn = compact ? "h-7 text-xs" : "";

  const addLink = async () => {
    setLinking(true);
    try {
      const res = await api.addOrbitLink(event.id);
      toast.success("Orbit is now the meeting link", {
        description: res.linkedInInvite
          ? "Attendees see it on the invite."
          : "Room is ready, but Google wouldn't let us edit this invite (you're not the organizer) — copy the link to share it.",
      });
      qc.invalidateQueries({ queryKey: qk.calendarEvents });
    } catch (err) {
      toast.error("Couldn't add the Orbit link", { description: (err as Error).message });
    } finally {
      setLinking(false);
    }
  };

  const copy = async () => {
    if (!event.orbitUrl) return;
    await navigator.clipboard.writeText(event.orbitUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!event.orbitRoomId) {
    return (
      <Button size="sm" variant="outline" className={`shrink-0 gap-1.5 ${btn}`} onClick={addLink} disabled={linking}>
        {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        {compact ? "Link" : "Add Orbit link"}
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" className={`shrink-0 gap-1.5 ${btn}`} asChild>
        <Link href={`/call/${event.orbitRoomId}`}><Video className="h-3.5 w-3.5" /> Join</Link>
      </Button>
      {!event.linkedInInvite && !compact && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={addLink} disabled={linking} aria-label="Retry writing the link onto the invite">
              {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Retry writing the Orbit link onto the invite</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={copy} aria-label="Copy Orbit link">
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy Orbit link</TooltipContent>
      </Tooltip>
    </>
  );
}
