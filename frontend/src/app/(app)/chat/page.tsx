"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquarePlus,
  Square,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import { OrbitMark } from "@/components/shared/logo";
import type { ChatCitation, ChatDraft, ChatMessage } from "@/lib/types";
import { rankFinding, sourceKey } from "@/lib/sources";
import { qk, useCredits, useFeed } from "@/lib/hooks";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { OutOfCreditsNotice } from "@/components/shared/credits";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, timeAgo } from "@/lib/utils";

const DEFAULT_SUGGESTIONS = [
  { title: "What's at risk right now?", hint: "Surface aging commitments and stalled work" },
  { title: "What did we promise customers?", hint: "Open commitments and their status" },
  { title: "Who's working on what?", hint: "Live ownership across the team" },
  { title: "What shipped recently?", hint: "Completed work, straight from your tools" },
];

const PHASE_COPY: Record<string, string> = {
  retrieving: "Searching company memory…",
  reasoning: "Reasoning over the evidence…",
  drafting: "Drafting a ticket…",
  remembering: "Committing that to memory…",
};

function phaseLabel(phase: string | null): string {
  if (!phase) return "Thinking…";
  if (phase.startsWith("pulling:"))
    return `Pulling fresh data from ${phase.slice(8)} — big syncs can take a minute…`;
  return PHASE_COPY[phase] ?? "Thinking…";
}

function PhaseStatus({ phase, className }: { phase: string | null; className?: string }) {
  return (
    <div className={cn("flex h-7 items-center gap-2 text-sm text-muted-foreground", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      <span className="animate-pulse">{phaseLabel(phase)}</span>
    </div>
  );
}

type Msg = ChatMessage & {
  streaming?: boolean;
  stopped?: boolean;
  thinking?: string;
  thoughtFor?: number;
};

function CitationChip({ c }: { c: ChatCitation }) {
  const key = sourceKey(c.source);
  const body = (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm transition-all hover:border-primary/40 hover:bg-accent/60">
      {key ? (
        <IntegrationLogo k={key} className="h-4 w-4 rounded-[4px] border-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="max-w-[260px] truncate font-medium">{c.title}</span>
      {c.url ? <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
    </span>
  );
  return c.url ? (
    <a href={c.url} target="_blank" rel="noreferrer" title={c.title} className="max-w-full">
      {body}
    </a>
  ) : (
    <span title={c.title} className="max-w-full">
      {body}
    </span>
  );
}

const CONNECTORS: { key: "linear" | "github"; label: string }[] = [
  { key: "linear", label: "Linear" },
  { key: "github", label: "GitHub" },
];

/** The in-chat closed loop: edit the drafted ticket, pick where it goes, approve
 *  to create it for real, then open the live link — all without leaving chat. */
function DraftCard({ draft, conversationId }: { draft: ChatDraft; conversationId: string | null }) {
  const [d, setD] = React.useState<ChatDraft>(draft);
  const [creating, setCreating] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const saved = React.useRef({ title: draft.title, description: draft.description });

  const editable = d.status === "pending";
  const targets = useQuery({
    queryKey: ["chat", "ticket-targets"],
    queryFn: api.getTicketTargets,
    enabled: editable,
  });
  const options =
    d.connector === "github"
      ? (targets.data?.github ?? []).map((r) => ({ value: r.fullName, label: r.fullName }))
      : (targets.data?.linear ?? []).map((t) => ({ value: t.id, label: t.name }));

  const persist = async (patch: Partial<ChatDraft>) => {
    if (!conversationId) return; // brand-new convo not saved yet — server has the draft after 'done'
    try {
      const updated = await api.editChatAction(conversationId, d.actionId, patch as never);
      setD(updated);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveText = (field: "title" | "description") => {
    if (d[field] === saved.current[field]) return;
    saved.current[field] = d[field];
    void persist({ [field]: d[field] } as Partial<ChatDraft>);
  };

  const switchConnector = (key: "linear" | "github") => {
    if (key === d.connector) return;
    setD((x) => ({ ...x, connector: key, target: null, targetLabel: null }));
    void persist({ connector: key });
  };

  const approve = async () => {
    if (!conversationId) return;
    setCreating(true);
    try {
      const res = await api.approveChatAction(conversationId, d.actionId);
      setD((x) => ({ ...x, status: "created", result: res.result }));
      toast.success(`Created ${res.result?.identifier ?? "the ticket"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    if (conversationId)
      void api.editChatAction(conversationId, d.actionId, { discard: true }).catch(() => {});
  };

  if (dismissed || d.status === "discarded") return null;

  const created = d.status === "created" && d.result?.url;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2">
        <IntegrationLogo k={d.connector} className="h-4 w-4 rounded-[4px] border-0" />
        <span className="text-xs font-semibold">
          {created ? "Ticket created" : d.proactive ? "Suggested ticket" : "Draft ticket"}
        </span>
        {created ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            <Ticket className="h-3 w-3" /> {d.proactive ? "Suggested" : "Needs approval"}
          </span>
        )}
      </div>

      <div className="space-y-3 p-3">
        {editable ? (
          <>
            <Input
              value={d.title}
              onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
              onBlur={() => saveText("title")}
              placeholder="Ticket title"
              className="font-medium"
            />
            <Textarea
              value={d.description}
              onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))}
              onBlur={() => saveText("description")}
              placeholder="Description"
              rows={4}
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-border p-0.5">
                {CONNECTORS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => switchConnector(c.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      d.connector === c.key
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <IntegrationLogo k={c.key} className="h-3.5 w-3.5 rounded-[3px] border-0" />
                    {c.label}
                  </button>
                ))}
              </div>
              <Select
                value={d.target ?? ""}
                onValueChange={(v) => {
                  const opt = options.find((o) => o.value === v);
                  setD((x) => ({ ...x, target: v, targetLabel: opt?.label ?? v }));
                  void persist({ target: v, targetLabel: opt?.label ?? v });
                }}
              >
                <SelectTrigger className="min-w-[10rem] flex-1 text-xs">
                  <SelectValue
                    placeholder={
                      targets.isLoading
                        ? "Loading…"
                        : d.connector === "github"
                          ? "Choose a repo"
                          : "Choose a team"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium">{d.title}</div>
            {d.description ? (
              <div className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">
                {d.description}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2">
        {created ? (
          <a
            href={d.result!.url!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            Open {d.result?.identifier ?? "ticket"} <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : (
          <>
            <Button size="sm" onClick={approve} disabled={creating || !conversationId || !d.target}>
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {creating ? "Creating…" : "Approve & create"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={creating}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function OrbitAvatar({ thinking: _thinking }: { thinking?: boolean }) {
  return <OrbitMark className="mt-1 h-7 w-7 shrink-0 drop-shadow-sm" />;
}

/** Hand-styled markdown so answers read like a polished product, not raw text. */
function Prose({ children }: { children: string }) {
  return (
    <div className="min-w-0 text-[15px] leading-7">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (p) => <p className="mb-3 last:mb-0" {...p} />,
          ul: (p) => <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0" {...p} />,
          ol: (p) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0" {...p} />,
          li: (p) => <li className="marker:text-muted-foreground" {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          a: (p) => (
            <a
              className="font-medium text-primary underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...p}
            />
          ),
          h1: (p) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...p} />,
          h2: (p) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...p} />,
          h3: (p) => <h3 className="mb-2 mt-4 text-[15px] font-semibold first:mt-0" {...p} />,
          code: (p) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]" {...p} />
          ),
          pre: (p) => (
            <pre
              className="mb-3 overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs [&_code]:bg-transparent [&_code]:p-0"
              {...p}
            />
          ),
          table: (p) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          th: (p) => (
            <th className="border-b border-border px-2 py-1.5 text-left font-semibold" {...p} />
          ),
          td: (p) => <td className="border-b border-border/50 px-2 py-1.5" {...p} />,
          blockquote: (p) => (
            <blockquote
              className="mb-3 border-l-2 border-primary/40 pl-3 text-muted-foreground"
              {...p}
            />
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

function ThinkingBlock({
  text,
  active,
  seconds,
}: {
  text: string;
  active: boolean;
  seconds?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (active) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [text, active]);
  const expanded = open || active;
  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        <span className={cn(active && "animate-pulse")}>
          {active ? "Thinking…" : `Thought for ${seconds ?? 0}s`}
        </span>
      </button>
      {expanded && text ? (
        <div
          ref={boxRef}
          className="no-scrollbar mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground"
        >
          {text}
        </div>
      ) : null}
    </div>
  );
}

function RatingRow({
  rating,
  onRate,
}: {
  rating?: "up" | "down" | null;
  onRate: (r: "up" | "down") => void;
}) {
  const [thanks, setThanks] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const rate = (r: "up" | "down") => {
    onRate(r);
    setThanks(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setThanks(false), 2500);
  };
  const btn = (r: "up" | "down", Icon: typeof ThumbsUp) => (
    <button
      onClick={() => rate(r)}
      aria-label={r === "up" ? "Helpful" : "Not helpful"}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        rating === r && (r === "up" ? "text-success" : "text-destructive"),
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
  // Stays visible once rated (so the highlight is always shown); hover-reveal otherwise.
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-1 transition-opacity",
        rating ? "opacity-100" : "opacity-0 group-hover:opacity-100 has-[button:focus]:opacity-100",
      )}
    >
      {btn("up", ThumbsUp)}
      {btn("down", ThumbsDown)}
      {thanks ? (
        <span className="ml-1 text-[11px] text-muted-foreground animate-in fade-in">
          Thanks for your feedback
        </span>
      ) : null}
    </div>
  );
}

function AssistantMessage({
  m,
  phase,
  conversationId,
  index,
  onRate,
}: {
  m: Msg;
  phase: string | null;
  conversationId: string | null;
  index: number;
  onRate: (index: number, rating: "up" | "down") => void;
}) {
  const waiting = m.streaming && !m.content && !m.thinking;
  return (
    <div className="group flex gap-3.5">
      <OrbitAvatar thinking={m.streaming} />
      <div className="min-w-0 flex-1 pt-0.5">
        {waiting ? (
          <PhaseStatus phase={phase} />
        ) : (
          <>
            {m.thinking ? (
              <ThinkingBlock
                text={m.thinking}
                active={!!m.streaming && !m.content}
                seconds={m.thoughtFor}
              />
            ) : null}
            {m.streaming && !m.content ? (
              // Long tool steps happen AFTER thinking streams — keep the live
              // status visible until the first answer token, never a bare cursor.
              <PhaseStatus phase={phase} className="mt-2 animate-in fade-in duration-300" />
            ) : null}
            {m.content ? <Prose>{m.streaming ? m.content + " ▍" : m.content}</Prose> : null}
            {m.stopped ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Stopped — this answer wasn&apos;t saved to history.
              </div>
            ) : null}
            {!m.streaming && m.grounded === false ? (
              <div className="mt-2 text-xs text-muted-foreground">
                Answered from general knowledge, not your company&apos;s data.
              </div>
            ) : null}
            {!m.streaming && m.draft ? (
              <DraftCard draft={m.draft} conversationId={conversationId} />
            ) : null}
            {!m.streaming && m.citations && m.citations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
                <span className="flex w-full items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Sources
                </span>
                {m.citations.map((c) => (
                  <CitationChip key={c.id} c={c} />
                ))}
              </div>
            ) : null}
            {!m.streaming && m.content && !m.stopped ? (
              <RatingRow rating={m.rating} onRate={(r) => onRate(index, r)} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [phase, setPhase] = React.useState<string | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [loadingConv, setLoadingConv] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickRef = React.useRef(true);
  const abortRef = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const conversations = useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: api.listChatConversations,
  });
  const { data: feed } = useFeed();
  const { data: credits } = useCredits();
  const outOfCredits = !!credits?.exhausted;

  // Live suggestions: what Orbit's radar flagged right now beats canned prompts.
  const suggestions: { title: string; hint: string; ask?: string }[] = React.useMemo(() => {
    const open = (feed?.findings ?? []).filter((f) => f.status === "open");
    const live = [...open]
      .sort((a, b) => rankFinding(b) - rankFinding(a))
      .slice(0, 2)
      .map((f) => ({
        title: f.title,
        hint: "From Orbit's radar — ask why and what to do",
        ask: `Explain this finding and what we should do about it: "${f.title}"`,
      }));
    return [...live, ...DEFAULT_SUGGESTIONS.slice(0, 4 - live.length)];
  }, [feed]);

  // Deep links from other surfaces ("Ask Orbit" on an entity) prefill the box.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setInput(q);
      window.history.replaceState({}, "", window.location.pathname);
      inputRef.current?.focus();
    }
  }, []);
  const convs = conversations.data ?? [];

  const pendingRef = React.useRef("");
  const doneRef = React.useRef<import("@/lib/types").ChatAnswer | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const appendToLast = (text: string) =>
    setMessages((m) => {
      const next = [...m];
      const last = next[next.length - 1];
      if (last?.role === "assistant")
        next[next.length - 1] = { ...last, content: last.content + text };
      return next;
    });

  const finishLast = (patch: Partial<Msg>) =>
    setMessages((m) => {
      const next = [...m];
      const last = next[next.length - 1];
      if (last?.role === "assistant")
        next[next.length - 1] = { ...last, ...patch, streaming: false };
      return next;
    });

  const finalize = React.useCallback(
    (final: import("@/lib/types").ChatAnswer) => {
      finishLast({
        citations: final.citations,
        grounded: final.grounded,
        draft: final.draft ?? null,
      });
      setStreaming(false);
      setActiveId(final.conversationId);
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      qc.invalidateQueries({ queryKey: qk.credits });
    },
    [qc],
  );

  const drain = React.useCallback(() => {
    const pending = pendingRef.current;
    if (pending) {
      const n = Math.min(24, Math.max(2, Math.round(pending.length / 40)));
      pendingRef.current = pending.slice(n);
      appendToLast(pending.slice(0, n));
      rafRef.current = requestAnimationFrame(drain);
    } else if (doneRef.current) {
      const final = doneRef.current;
      doneRef.current = null;
      rafRef.current = null;
      finalize(final);
    } else {
      rafRef.current = null;
    }
  }, [finalize]);

  const kickDrain = React.useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(drain);
  }, [drain]);

  const thinkStartRef = React.useRef<number | null>(null);
  const answerStartedRef = React.useRef(false);

  const resetStream = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pendingRef.current = "";
    doneRef.current = null;
    thinkStartRef.current = null;
    answerStartedRef.current = false;
  };

  const appendThinking = (t: string) =>
    setMessages((m) => {
      const next = [...m];
      const last = next[next.length - 1];
      if (last?.role === "assistant")
        next[next.length - 1] = { ...last, thinking: (last.thinking ?? "") + t };
      return next;
    });

  const send = (text: string) => {
    const q = text.trim();
    if (!q || streaming) return;
    if (outOfCredits) {
      toast.error("You're out of chat credits. Request more to keep asking Orbit.");
      return;
    }
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setMessages((m) => [
      ...m,
      { role: "user", content: q },
      { role: "assistant", content: "", streaming: true },
    ]);
    setPhase(null);
    setStreaming(true);
    stickRef.current = true;
    resetStream();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    void api.streamChat(
      { message: q, conversationId: activeId },
      {
        onPhase: (p, connector) => setPhase(connector ? `pulling:${connector}` : p),
        onThinking: (t) => {
          if (thinkStartRef.current == null) thinkStartRef.current = Date.now();
          appendThinking(t);
        },
        onDelta: (t) => {
          if (thinkStartRef.current != null && !answerStartedRef.current) {
            answerStartedRef.current = true;
            const secs = Math.max(1, Math.round((Date.now() - thinkStartRef.current) / 1000));
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, thoughtFor: secs };
              return next;
            });
          }
          pendingRef.current += t;
          kickDrain();
        },
        onDraft: (draft) =>
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, draft };
            return next;
          }),
        onDone: (final) => {
          doneRef.current = final;
          kickDrain();
        },
        onError: (msg) => {
          resetStream();
          finishLast({ content: msg, grounded: false });
          setStreaming(false);
          // The server is the authority on the balance (another tab may have spent it).
          qc.invalidateQueries({ queryKey: qk.credits });
        },
      },
      ctrl.signal,
    );
  };

  const stop = () => {
    abortRef.current?.abort();
    const rest = pendingRef.current;
    resetStream();
    if (rest) appendToLast(rest);
    finishLast({ stopped: true });
    setStreaming(false);
  };

  const openConversation = async (id: string) => {
    if (id === activeId) return;
    if (streaming) stop();
    setActiveId(id);
    setLoadingConv(true);
    try {
      const conv = await api.getChatConversation(id);
      setMessages(conv.messages);
      stickRef.current = true;
    } catch {
      toast.error("Couldn't load that conversation");
      setMessages([]);
    } finally {
      setLoadingConv(false);
    }
  };

  const newChat = () => {
    if (streaming) stop();
    setActiveId(null);
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  const doDelete = async (id: string) => {
    try {
      await api.deleteChatConversation(id);
      if (id === activeId) newChat();
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    } catch (e) {
      toast.error("Couldn't delete that conversation");
      throw e;
    }
  };

  const rate = React.useCallback(
    async (index: number, rating: "up" | "down") => {
      if (!activeId) return;
      setMessages((m) => m.map((x, i) => (i === index ? { ...x, rating } : x)));
      try {
        await api.rateChatAnswer(activeId, index, rating);
      } catch {
        toast.error("Couldn't save your feedback");
      }
    },
    [activeId],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  React.useEffect(() => {
    if (stickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, phase]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const autogrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div className="flex h-[calc(100vh-6.5rem)] gap-6">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 flex-col md:flex">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 border-dashed"
          onClick={newChat}
        >
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
        {convs.length > 0 ? (
          <div className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent
          </div>
        ) : null}
        <div className="no-scrollbar mt-1 flex-1 space-y-0.5 overflow-y-auto pb-2">
          {convs.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60",
                c.id === activeId && "bg-accent",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.title || "New chat"}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {timeAgo(c.updatedAt)}
                </span>
              </span>
              <Trash2
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(c.id);
                }}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              />
            </button>
          ))}
          {convs.length === 0 && !conversations.isLoading ? (
            <p className="mt-3 px-2.5 text-xs leading-relaxed text-muted-foreground">
              Your conversations live here, private to you.
            </p>
          ) : null}
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="no-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[44rem] px-1 py-6">
            {loadingConv ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-[55vh] animate-in flex-col items-center justify-center fade-in-0 zoom-in-95 text-center duration-500">
                <OrbitMark className="h-14 w-14 drop-shadow-[0_0_18px_hsl(var(--primary)/0.5)]" />
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">
                  Ask your company anything
                </h1>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Orbit has read your issues, threads, calls and docs. Every answer is grounded in
                  your own data, with sources.
                </p>
                <div className="mt-8 grid w-full max-w-lg gap-2.5 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.title}
                      onClick={() => send(s.ask ?? s.title)}
                      className="group rounded-xl border border-border bg-card/50 px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/5"
                    >
                      <div className="line-clamp-2 text-sm font-medium">{s.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground group-hover:text-muted-foreground/80">
                        {s.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {messages.map((m, i) => (
                  <div key={i} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                    {m.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-sm">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <AssistantMessage
                        m={m}
                        phase={phase}
                        conversationId={activeId}
                        index={i}
                        onRate={rate}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="mx-auto w-full max-w-[44rem] pb-2 pt-3">
          {outOfCredits ? <OutOfCreditsNotice /> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className={cn(
              "relative rounded-2xl border border-border bg-card shadow-lg shadow-black/5 transition-all duration-300 focus-within:border-primary/50 focus-within:shadow-[0_0_40px_-12px] focus-within:shadow-primary/40",
              outOfCredits && "opacity-60 shadow-none focus-within:border-border",
            )}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autogrow(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                outOfCredits
                  ? "Out of credits. Request more to keep asking."
                  : "Ask about customers, risks, ownership, what's shipping…"
              }
              rows={1}
              autoFocus
              disabled={outOfCredits}
              className="max-h-[200px] w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            <div className="absolute bottom-2.5 right-2.5">
              {streaming ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={stop}
                  aria-label="Stop generating"
                  className="rounded-lg"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={!input.trim() || outOfCredits}
                  aria-label="Send"
                  className="rounded-lg"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Orbit answers from your company&apos;s own data and cites its sources · Shift+Enter for
            a new line
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete conversation?"
        description="This conversation and its messages will be permanently removed. This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => doDelete(pendingDelete!)}
      />
    </div>
  );
}
