"use client";

// Ask Orbit — grounded chat over the workspace's approved knowledge, with
// persistent conversation history (like Claude/GPT). Every answer comes from
// the backend Context Engine: SQL facts + pgvector semantic recall for the
// bound customer — never a raw DB dump. `?customer=` pre-binds the context.

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Command } from "cmdk";
import {
  ArrowUp, Building2, Check, ChevronsUpDown, FileText, Handshake, Loader2,
  MessageCircle, Plus, Sparkles, Trash2, Video,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { ChatMessage, ChatConversationSummary, Customer } from "@/lib/types";
import { qk, useChatConversations, useCustomers } from "@/lib/hooks";
import { cn, timeAgo } from "@/lib/utils";
import { OrbitMark } from "@/components/shared/logo";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const SUGGESTED_PROMPTS = [
  "What did the customer request last month?",
  "Show open commitments",
  "What changed after the previous meeting?",
  "What PRDs have been approved?",
];

const SOURCE_ICON: Record<string, React.ElementType> = {
  meeting: Video, plan: FileText, commitment: Handshake,
};

function ChatInner() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: customers } = useCustomers();
  const { data: conversations } = useChatConversations();

  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [customerId, setCustomerId] = React.useState<string | null>(params.get("customer"));
  const [turns, setTurns] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const newChat = () => {
    setConversationId(null);
    setTurns([]);
    setCustomerId(null);
  };

  const openConversation = async (c: ChatConversationSummary) => {
    try {
      const detail = await api.getChatConversation(c.id);
      setConversationId(detail.id);
      setCustomerId(detail.customerId ?? null);
      setTurns(detail.messages);
    } catch (err) {
      toast.error("Couldn't open the conversation", { description: (err as Error).message });
    }
  };

  const [deleteTarget, setDeleteTarget] = React.useState<ChatConversationSummary | null>(null);
  const removeConversation = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteChatConversation(deleteTarget.id);
      qc.invalidateQueries({ queryKey: qk.chatConversations });
      if (deleteTarget.id === conversationId) newChat();
      toast.success("Conversation deleted");
    } catch (err) {
      toast.error("Couldn't delete", { description: (err as Error).message });
      throw err;
    }
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await api.sendChat(message, customerId, conversationId);
      if (res.customerId) setCustomerId(res.customerId);
      if (res.conversationId) setConversationId(res.conversationId);
      setTurns((t) => [...t, { role: "assistant", content: res.answer, sources: res.sources }]);
      qc.invalidateQueries({ queryKey: qk.chatConversations });
    } catch (err) {
      toast.error("Orbit couldn't answer", { description: (err as Error).message });
      setTurns((t) => t.slice(0, -1));
      setInput(message);
    } finally {
      setBusy(false);
    }
  };

  const activeCustomer = customers?.find((c) => c.id === customerId);

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {/* ── History rail ── */}
      <aside className="hidden w-60 shrink-0 flex-col lg:flex">
        <Button variant="outline" className="mb-3 w-full justify-start gap-2" onClick={newChat}>
          <Plus className="h-4 w-4" /> New chat
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          {conversations === undefined && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          {conversations?.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">Your conversations will appear here.</p>
          )}
          {conversations?.map((c) => (
            <button key={c.id} onClick={() => openConversation(c)}
              className={cn(
                "group flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                c.id === conversationId
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-accent",
              )}>
              <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{c.title}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {c.customerName ? `${c.customerName} · ` : ""}{timeAgo(c.updatedAt)}
                </span>
              </span>
              <Trash2 onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors hover:!text-destructive group-hover:text-muted-foreground" />
            </button>
          ))}
        </div>
      </aside>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete this conversation?"
        description={<>&ldquo;{deleteTarget?.title}&rdquo; and its messages will be permanently removed.</>}
        confirmLabel="Delete conversation"
        destructive
        onConfirm={removeConversation}
      />

      {/* ── Conversation ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card">
            <OrbitMark className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight">Ask Orbit</h1>
            <p className="truncate text-xs text-muted-foreground">
              {activeCustomer
                ? <>Context: <span className="font-medium text-foreground/80">{activeCustomer.name}</span> — {activeCustomer.meetingCount} meetings, {activeCustomer.openCommitments} open commitments</>
                : "Pick a customer, or just name one in your question"}
            </p>
          </div>
          <CustomerPicker customers={customers ?? []} value={customerId} onChange={setCustomerId} />
        </div>

        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto pr-1">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card">
                <OrbitMark className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-base font-semibold">What do you want to know?</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Orbit answers from approved knowledge only — meetings, execution plans and commitments.
                {(customers?.length ?? 0) === 0 && " Analyze a meeting first to build some history."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button key={p} onClick={() => send(p)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <OrbitMark className="h-5 w-5" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-tr-sm bg-primary text-primary-foreground"
                  : "rounded-tl-sm border border-border bg-card"
              }`}>
                <span className="whitespace-pre-wrap">{m.content}</span>
                {!!m.sources?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                    {m.sources.map((sc, j) => {
                      const Icon = SOURCE_ICON[sc.type] ?? FileText;
                      const href = sc.type === "meeting" ? `/meetings/${sc.id}` : undefined;
                      const chip = (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          <Icon className="h-3 w-3" /> {sc.title}
                        </span>
                      );
                      return href
                        ? <Link key={j} href={href} className="transition-opacity hover:opacity-80">{chip}</Link>
                        : <React.Fragment key={j}>{chip}</React.Fragment>;
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          ))}

          {busy && (
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                <OrbitMark className="h-5 w-5" />
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        <div className="pt-3">
          <form
            onSubmit={(e) => { e.preventDefault(); void send(); }}
            className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-card"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={activeCustomer
                ? `Ask about ${activeCustomer.name}…`
                : "Ask about a customer, a commitment, an approved plan…"}
              className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40">
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// Searchable customer picker — a Select breaks down past a dozen customers;
// this combobox filters as you type and scales to hundreds.
function CustomerPicker({ customers, value, onChange }: {
  customers: Customer[]; value: string | null; onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const active = customers.find((c) => c.id === value);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" role="combobox" aria-expanded={open}
          className="h-8 w-48 justify-between gap-1.5 text-xs font-normal">
          <span className="flex min-w-0 items-center gap-1.5">
            {active
              ? <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              : <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{active ? active.name : "Detect from question"}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command>
          <Command.Input autoFocus placeholder="Search customers…"
            className="w-full border-b border-border bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
              No customer matches.
            </Command.Empty>
            <Command.Item value="detect from question" onSelect={() => pick(null)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-accent">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">Detect from question</span>
              {!active && <Check className="h-3.5 w-3.5 text-primary" />}
            </Command.Item>
            {customers.map((c) => (
              <Command.Item key={c.id} value={c.name} onSelect={() => pick(c.id)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-accent">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {c.meetingCount} meeting{c.meetingCount === 1 ? "" : "s"}
                    {c.openCommitments > 0 && <> · {c.openCommitments} open commitment{c.openCommitments === 1 ? "" : "s"}</>}
                  </span>
                </span>
                {value === c.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ChatInner />
    </Suspense>
  );
}
