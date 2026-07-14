"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { OrbitWordmark } from "@/components/shared/logo";

const highlights = [
  {
    icon: Sparkles,
    title: "Signals in, intelligence out",
    desc: "Conversations, documents and tool data become company context Orbit reasons over, surfacing risks, gaps and what to do next.",
  },
  {
    icon: CheckCircle2,
    title: "You review, you approve",
    desc: "Everything is an editable draft. Nothing reaches a customer or a tool without your sign-off.",
  },
  {
    icon: RefreshCw,
    title: "Your tools stay in charge",
    desc: "Approved updates sync back into the tools your team already uses, which stay the system of record.",
  },
];

/**
 * The single branded auth layout: a brand panel on the left and a slot on the
 * right for whatever the flow needs (sign-in, invitation acceptance, …). Every
 * auth surface renders through this so they are visually identical and there is
 * one place to maintain. Purely Orbit-branded — no third-party marks.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card/30 p-12 lg:flex">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-12 right-0 h-64 w-64 rounded-full bg-orbit-500/10 blur-3xl" />
        <div className="relative">
          <OrbitWordmark />
        </div>
        <div className="relative space-y-8">
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
            The <span className="text-gradient-brand">AI Operating System</span> for your company.
          </h1>
          <div className="space-y-5">
            {highlights.map((h, i) => (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.1 }}
                className="flex items-start gap-3"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <h.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">{h.title}</div>
                  <div className="text-sm text-muted-foreground">{h.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Orbit proposes · You approve · Your tools stay the system of record
        </div>
      </div>

      {/* Content panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <OrbitWordmark />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
