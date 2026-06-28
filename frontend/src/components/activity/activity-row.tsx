"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import type { ActivityEvent } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/avatar";

export function targetHref(e: ActivityEvent): string {
  switch (e.targetType) {
    case "meeting":
      return "/meetings";
    case "integration":
      return "/integrations";
    default:
      return "/graph";
  }
}

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

export function ActivityRow({ event, isLast }: { event: ActivityEvent; isLast: boolean }) {
  const { actor, action, target } = event;

  return (
    <motion.li variants={rowVariants} transition={{ duration: 0.25 }} className="relative flex gap-3">
      {/* timeline rail */}
      {!isLast ? <span aria-hidden className="absolute left-[15px] top-9 bottom-0 w-px bg-border" /> : null}

      {/* avatar */}
      <div className="relative z-10 shrink-0">
        {actor.isAgent ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
            <Bot className="h-4 w-4" />
          </div>
        ) : (
          <UserAvatar name={actor.name} src={actor.avatarUrl} className="h-8 w-8" />
        )}
      </div>

      {/* content */}
      <div className="min-w-0 flex-1 pb-5">
        <p className="text-sm leading-relaxed">
          <span className="font-medium text-foreground">{actor.name}</span>{" "}
          <span className="text-muted-foreground">{action}</span>{" "}
          <Link
            href={targetHref(event)}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {target}
          </Link>
        </p>
        <span className="mt-0.5 block text-xs text-muted-foreground">{timeAgo(event.at)}</span>
      </div>
    </motion.li>
  );
}
