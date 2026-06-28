"use client";

import { motion } from "framer-motion";
import { ArrowUp, Lock, Sparkles, Video } from "lucide-react";
import { OrbitMark } from "@/components/shared/logo";

// Static, decorative preview of the assistant. It is intentionally
// non-interactive — Ask Orbit is gated behind a "Coming soon" overlay.
const PREVIEW_PROMPTS = [
  "What did Northwind say on their last call?",
  "What features are customers asking for?",
  "Which projects are at risk?",
];

const PREVIEW_BUBBLES = [
  { role: "user" as const, text: "What did Northwind say on their last call?" },
  {
    role: "assistant" as const,
    text: "Northwind flagged SSO as a blocker for their security review, with $240k of expansion tied to it. I've pulled the call and the two related follow-ups.",
  },
];

export default function ChatPage() {
  return (
    <div className="relative mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      {/* Blurred, non-interactive preview of the chat experience. */}
      <div aria-hidden className="pointer-events-none flex h-full select-none flex-col opacity-50 blur-[3px]">
        <div className="flex items-center gap-3 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card">
            <OrbitMark className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Ask Orbit</h1>
            <p className="text-xs text-muted-foreground">Context: every meeting, plan and ticket</p>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-hidden">
          {PREVIEW_BUBBLES.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <OrbitMark className="h-5 w-5" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-tl-sm border border-border bg-card"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            {PREVIEW_PROMPTS.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground">
                <Video className="h-3 w-3" /> {p}
              </span>
            ))}
          </div>
        </div>

        <div className="pt-3">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-card">
            <div className="flex-1 px-2 py-1.5 text-sm text-muted-foreground">Ask about a call, a customer, a project…</div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ArrowUp className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Coming soon overlay — keeps the feature visible but unusable. */}
      <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="flex max-w-sm flex-col items-center rounded-2xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Lock className="h-3 w-3" /> Coming soon
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Ask Orbit</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            A grounded assistant over every meeting, plan and ticket in your workspace. We&apos;re putting the
            finishing touches on it — check back soon.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
