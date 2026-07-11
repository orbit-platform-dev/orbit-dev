"use client";

// Add a signal: a conversation transcript or a company document. Both feed the
// same analysis pipeline and become part of company context. No fake tabs —
// recording transcription and auto-import live on the integrations roadmap.

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runTranscript } from "@/lib/api";
import { qk, useCustomers } from "@/lib/hooks";

export function MeetingUploadDialog({ open, onOpenChange, initialAccount }: {
  open: boolean; onOpenChange: (v: boolean) => void; initialAccount?: string;
}) {
  const [source, setSource] = React.useState<"transcript" | "document">("transcript");
  const [title, setTitle] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { data: customers } = useCustomers();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Opened from a customer page → that customer is pre-selected.
  React.useEffect(() => {
    if (open && initialAccount) setAccount(initialAccount);
  }, [open, initialAccount]);

  const reset = () => {
    setTitle(""); setAccount(""); setText(""); setBusy(false);
  };

  const submit = async () => {
    if (!text.trim()) {
      toast.error(source === "transcript" ? "Paste a transcript first" : "Paste the document text first");
      return;
    }
    setBusy(true);
    try {
      const { meetingId } = await runTranscript({
        transcript: text, source,
        title: title.trim() || undefined,
        account: account.trim() || undefined,
      });
      toast.success("Signal added — analyzing now", { description: "Watch Orbit build understanding in real time." });
      for (const key of [qk.meetings, qk.dashboard, qk.projects, qk.tasks, qk.timeline, qk.activity, qk.customers]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onOpenChange(false);
      setTimeout(reset, 300);
      router.push(`/signals/${meetingId}`);
    } catch (e) {
      toast.error("Analysis failed", { description: (e as Error).message });
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 300);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a signal</DialogTitle>
          <DialogDescription>
            Conversations and documents become company context Orbit can reason over.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={source} onValueChange={(v) => setSource(v as "transcript" | "document")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="transcript" className="gap-1.5">
              <MessagesSquare className="h-3.5 w-3.5" /> Conversation
            </TabsTrigger>
            <TabsTrigger value="document" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Document
            </TabsTrigger>
          </TabsList>

          {(["transcript", "document"] as const).map((kind) => (
            <TabsContent key={kind} value={kind} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-title">Title</Label>
                <Input
                  id="s-title"
                  placeholder={kind === "transcript" ? "e.g. Acme — Q3 renewal call" : "e.g. Platform reliability plan"}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-account">Customer <span className="text-muted-foreground">(optional for internal docs)</span></Label>
                <Input
                  id="s-account"
                  list="signal-customer-suggestions"
                  placeholder="e.g. Acme Inc — links this signal to their history"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                />
                <datalist id="signal-customer-suggestions">
                  {(customers ?? []).map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-body">{kind === "transcript" ? "Transcript" : "Document text"}</Label>
                <Textarea
                  id="s-body"
                  rows={6}
                  placeholder={kind === "transcript"
                    ? "[00:00] Speaker 1: …\n[00:42] Speaker 2: …"
                    : "Paste the document content…"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            
              <p className="text-center text-[11px] text-muted-foreground/70">
                Zoom and Google Meet import transcripts automatically once connected. Recording transcription is on the roadmap.
              </p>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
