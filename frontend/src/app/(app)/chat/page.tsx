"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, ArrowUpRight, FileText, Loader2, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import * as api from "@/lib/api";
import type { ChatCitation, ChatMessage, IntegrationKey } from "@/lib/types";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What's at risk right now?",
  "What have we promised customers that isn't done?",
  "What are we building that no one asked for?",
  "What shipped recently?",
];

const NON_CONNECTOR = new Set(["call", "document", "doc", "note", "email", "manual"]);
function sourceKey(source: string): IntegrationKey | null {
  const base = (source || "").split(/[-_ ]/)[0].toLowerCase();
  return !base || NON_CONNECTOR.has(base) ? null : (base as IntegrationKey);
}

function Citation({ c }: { c: ChatCitation }) {
  const key = sourceKey(c.source);
  const body = (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/70 px-2 py-1 text-xs transition-colors hover:bg-accent/60">
      {key ? (
        <IntegrationLogo k={key} className="h-4 w-4 rounded" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="max-w-[240px] truncate">{c.title}</span>
      {c.url ? <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
    </span>
  );
  return c.url ? (
    <a href={c.url} target="_blank" rel="noreferrer" title={c.title}>{body}</a>
  ) : (
    <span title={c.title}>{body}</span>
  );
}

function OrbitAvatar() {
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
      <Sparkles className="h-3.5 w-3.5 text-primary" />
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <OrbitAvatar />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
        {m.grounded === false ? (
          <div className="text-xs text-muted-foreground">Answered from general knowledge, not your company&apos;s data.</div>
        ) : null}
        {m.citations && m.citations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {m.citations.map((c) => <Citation key={c.id} c={c} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loadingConv, setLoadingConv] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const conversations = useQuery({ queryKey: ["chat", "conversations"], queryFn: api.listChatConversations });
  const convs = conversations.data ?? [];

  const chat = useMutation({
    mutationFn: (message: string) => api.sendChat({ message, conversationId: activeId }),
    onSuccess: (res) => {
      setActiveId(res.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, citations: res.citations, grounded: res.grounded }]);
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
    },
    onError: (e) =>
      setMessages((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "Something went wrong.", grounded: false }]),
  });

  const send = (text: string) => {
    const q = text.trim();
    if (!q || chat.isPending) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    chat.mutate(q);
  };

  const openConversation = async (id: string) => {
    if (id === activeId || chat.isPending) return;
    setActiveId(id);
    setLoadingConv(true);
    try {
      const conv = await api.getChatConversation(id);
      setMessages(conv.messages);
    } catch {
      toast.error("Couldn't load that conversation");
      setMessages([]);
    } finally {
      setLoadingConv(false);
    }
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setInput("");
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

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending, loadingConv]);

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-5">
      <aside className="hidden w-60 shrink-0 flex-col md:flex">
        <Button variant="outline" className="w-full justify-start gap-2" onClick={newChat}>
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
        <div className="no-scrollbar mt-3 flex-1 space-y-0.5 overflow-y-auto">
          {convs.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60",
                c.id === activeId && "bg-accent",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{c.title || "New chat"}</span>
              <Trash2
                onClick={(e) => remove(c.id, e)}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              />
            </button>
          ))}
          {convs.length === 0 && !conversations.isLoading ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">No conversations yet.</p>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1">
          <h1 className="text-xl font-semibold tracking-tight">Ask Orbit</h1>
          <p className="text-sm text-muted-foreground">
            Private to you. Ask anything about your company — Orbit reasons over everything it has learned and links the evidence.
          </p>
        </div>

        <div ref={scrollRef} className="no-scrollbar flex-1 space-y-5 overflow-y-auto py-4">
          {loadingConv ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="text-lg font-semibold">Ask Orbit anything</div>
                <div className="mt-1 text-sm text-muted-foreground">It has read your calls, issues, threads, tickets and docs.</div>
              </div>
              <div className="grid w-full max-w-md gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-border bg-card/50 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Bubble key={i} m={m} />)
          )}
          {chat.isPending ? (
            <div className="flex gap-3">
              <OrbitAvatar />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reasoning over your company…
              </div>
            </div>
          ) : null}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            placeholder="Ask about customers, risks, commitments, what's shipping…"
            rows={1}
            className="max-h-40 min-h-[52px] resize-none pr-12"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={!input.trim() || chat.isPending}
            className="absolute bottom-2.5 right-2.5"
          >
            {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </form>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Orbit cites the evidence it used. Your chats are private to you.
        </p>
      </div>
    </div>
  );
}
