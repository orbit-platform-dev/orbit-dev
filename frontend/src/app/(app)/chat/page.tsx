"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import * as api from "@/lib/api";
import type { ChatCitation, ChatMessage, IntegrationKey } from "@/lib/types";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";

const SUGGESTIONS = [
  { title: "What's at risk right now?", hint: "Surface aging commitments and stalled work" },
  { title: "What did we promise customers?", hint: "Open commitments and their status" },
  { title: "Who's working on what?", hint: "Live ownership across the team" },
  { title: "What shipped recently?", hint: "Completed work, straight from your tools" },
];

const PHASE_COPY: Record<string, string> = {
  retrieving: "Searching company memory…",
  reasoning: "Reasoning over the evidence…",
};

type Msg = ChatMessage & {
  streaming?: boolean;
  stopped?: boolean;
  thinking?: string;    
  thoughtFor?: number;  
};

const NON_CONNECTOR = new Set(["call", "document", "doc", "note", "email", "manual"]);
function sourceKey(source: string): IntegrationKey | null {
  const base = (source || "").split(/[-_ ]/)[0].toLowerCase();
  return !base || NON_CONNECTOR.has(base) ? null : (base as IntegrationKey);
}

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
    <a href={c.url} target="_blank" rel="noreferrer" title={c.title} className="max-w-full">{body}</a>
  ) : (
    <span title={c.title} className="max-w-full">{body}</span>
  );
}

function OrbitAvatar({ thinking }: { thinking?: boolean }) {
  return (
    <div
      className={cn(
        "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10",
        thinking && "animate-pulse",
      )}
    >
      <Sparkles className="h-3.5 w-3.5 text-primary" />
    </div>
  );
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
          a: (p) => <a className="font-medium text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
          h1: (p) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...p} />,
          h2: (p) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...p} />,
          h3: (p) => <h3 className="mb-2 mt-4 text-[15px] font-semibold first:mt-0" {...p} />,
          code: (p) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]" {...p} />,
          pre: (p) => (
            <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-card p-3 text-xs [&_code]:bg-transparent [&_code]:p-0" {...p} />
          ),
          table: (p) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          th: (p) => <th className="border-b border-border px-2 py-1.5 text-left font-semibold" {...p} />,
          td: (p) => <td className="border-b border-border/50 px-2 py-1.5" {...p} />,
          blockquote: (p) => <blockquote className="mb-3 border-l-2 border-primary/40 pl-3 text-muted-foreground" {...p} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}


function ThinkingBlock({ text, active, seconds }: { text: string; active: boolean; seconds?: number }) {
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

function AssistantMessage({ m, phase }: { m: Msg; phase: string | null }) {
  const waiting = m.streaming && !m.content && !m.thinking;
  return (
    <div className="flex gap-3.5">
      <OrbitAvatar thinking={m.streaming} />
      <div className="min-w-0 flex-1 pt-0.5">
        {waiting ? (
          <div className="flex h-7 items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {PHASE_COPY[phase ?? ""] ?? "Thinking…"}
          </div>
        ) : (
          <>
            {m.thinking ? (
              <ThinkingBlock text={m.thinking} active={!!m.streaming && !m.content} seconds={m.thoughtFor} />
            ) : null}
            <Prose>{m.streaming ? m.content + " ▍" : m.content}</Prose>
            {m.stopped ? (
              <div className="mt-2 text-xs text-muted-foreground">Stopped — this answer wasn&apos;t saved to history.</div>
            ) : null}
            {!m.streaming && m.grounded === false ? (
              <div className="mt-2 text-xs text-muted-foreground">Answered from general knowledge, not your company&apos;s data.</div>
            ) : null}
            {!m.streaming && m.citations && m.citations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
                <span className="flex w-full items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Sources
                </span>
                {m.citations.map((c) => <CitationChip key={c.id} c={c} />)}
              </div>
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
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickRef = React.useRef(true);
  const abortRef = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const conversations = useQuery({ queryKey: ["chat", "conversations"], queryFn: api.listChatConversations });
  const convs = conversations.data ?? [];


  const pendingRef = React.useRef("");
  const doneRef = React.useRef<import("@/lib/types").ChatAnswer | null>(null);
  const rafRef = React.useRef<number | null>(null);

  const appendToLast = (text: string) =>
    setMessages((m) => {
      const next = [...m];
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + text };
      return next;
    });

  const finishLast = (patch: Partial<Msg>) =>
    setMessages((m) => {
      const next = [...m];
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = { ...last, ...patch, streaming: false };
      return next;
    });

  const finalize = React.useCallback((final: import("@/lib/types").ChatAnswer) => {
    finishLast({ citations: final.citations, grounded: final.grounded });
    setStreaming(false);
    setActiveId(final.conversationId);
    qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
  }, [qc]);

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
      if (last?.role === "assistant") next[next.length - 1] = { ...last, thinking: (last.thinking ?? "") + t };
      return next;
    });

  const send = (text: string) => {
    const q = text.trim();
    if (!q || streaming) return;
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
        onPhase: setPhase,
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
        onDone: (final) => {
          doneRef.current = final;
          kickDrain();
        },
        onError: (msg) => {
          resetStream();
          finishLast({ content: msg, grounded: false });
          setStreaming(false);
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

  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteChatConversation(id);
      if (id === activeId) newChat();
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    } catch {
      toast.error("Couldn't delete that conversation");
    }
  };

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
        <Button variant="outline" className="w-full justify-start gap-2 border-dashed" onClick={newChat}>
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
        {convs.length > 0 ? (
          <div className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</div>
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
                <span className="block text-[11px] text-muted-foreground">{timeAgo(c.updatedAt)}</span>
              </span>
              <Trash2
                onClick={(e) => remove(c.id, e)}
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
              <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-[0_0_40px_-12px] shadow-primary/50">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">Ask your company anything</h1>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Orbit has read your issues, threads, calls and docs. Every answer is grounded in your
                  own data, with sources.
                </p>
                <div className="mt-8 grid w-full max-w-lg gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.title}
                      onClick={() => send(s.title)}
                      className="group rounded-xl border border-border bg-card/50 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-card"
                    >
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground group-hover:text-muted-foreground/80">{s.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <AssistantMessage key={i} m={m} phase={phase} />
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="mx-auto w-full max-w-[44rem] pb-2 pt-3">
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="relative rounded-2xl border border-border bg-card shadow-lg shadow-black/5 transition-colors focus-within:border-primary/50"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autogrow(e.target); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              placeholder="Ask about customers, risks, ownership, what's shipping…"
              rows={1}
              autoFocus
              className="max-h-[200px] w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
            />
            <div className="absolute bottom-2.5 right-2.5">
              {streaming ? (
                <Button type="button" size="icon-sm" variant="secondary" onClick={stop} aria-label="Stop generating" className="rounded-lg">
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="Send" className="rounded-lg">
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Orbit answers from your company&apos;s own data and cites its sources · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
