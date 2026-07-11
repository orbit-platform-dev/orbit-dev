"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, Sparkles, Video } from "lucide-react";
import type { DashboardData } from "@/lib/api";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { WidgetCard } from "./widget-card";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
export function RecentMeetings({ meetings }: { meetings: DashboardData["meetings"] }) {
  return (
    <></>
  );
}

// ---------------------------------------------------------------------------
export function LatestActivity({ activity }: { activity: DashboardData["activity"] }) {
  return (
    <></>
  );
}

// ---------------------------------------------------------------------------
export function StaggerGrid({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
      className="contents"
    >
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.3 }} className={className}>
      {children}
    </motion.div>
  );
}
