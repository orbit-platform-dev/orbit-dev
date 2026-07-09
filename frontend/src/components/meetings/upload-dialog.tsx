"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileAudio, FileText, FileVideo, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { runTranscript } from "@/lib/api";
import { qk, useCustomers } from "@/lib/hooks";

export function MeetingUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [dragging, setDragging] = React.useState(false);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "uploading" | "analyzing">("idle");
  const [progress, setProgress] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [transcript, setTranscript] = React.useState("");
  const { data: customers } = useCustomers();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const reset = () => {
    setPhase("idle");
    setProgress(0);
    setFileName(null);
    setTitle("");
    setAccount("");
    setTranscript("");
  };

  const simulate = (label: string) => {
    setPhase("uploading");
    setProgress(0);
    const t = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(t);
          setPhase("analyzing");
          setTimeout(() => {
            toast.success("Meeting uploaded", { description: `${label} — Meeting Intelligence is analyzing it now.` });
            onOpenChange(false);
            setTimeout(reset, 300);
          }, 1400);
          return 100;
        }
        return p + 8;
      });
    }, 90);
  };

  const analyzeTranscript = async () => {
    if (!transcript.trim()) {
      toast.error("Paste a transcript first");
      return;
    }
    setPhase("analyzing");
    try {
      const { meetingId } = await runTranscript({
        transcript, title: title.trim() || undefined, account: account.trim() || undefined,
      });
      toast.success("Analyzing the call…", { description: "Watch Orbit build the plan in real time." });
      for (const key of [qk.meetings, qk.dashboard, qk.graph, qk.projects, qk.tasks, qk.timeline, qk.activity]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onOpenChange(false);
      setTimeout(reset, 300);
      router.push(`/meetings/${meetingId}`); // land on the meeting so progress streams in
    } catch (e) {
      toast.error("Analysis failed", { description: (e as Error).message });
      setPhase("idle");
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setFileName(files[0].name);
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
          <DialogTitle>Upload a meeting</DialogTitle>
          <DialogDescription>
            Add a recording or transcript and Orbit&apos;s agents will analyze it, extract signals, and kick off work.
          </DialogDescription>
        </DialogHeader>

        {phase !== "idle" ? (
          <div className="py-6">
            <div className="flex items-center gap-3">
              {phase === "uploading" ? (
                <UploadCloud className="h-5 w-5 text-primary" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {phase === "uploading" ? "Uploading…" : "Running agents…"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {phase === "analyzing" ? "All agents run end-to-end — this can take up to a minute." : fileName ?? "meeting.mp4"}
                </div>
              </div>
              {phase === "uploading" && <span className="text-sm tabular-nums text-muted-foreground">{progress}%</span>}
            </div>
            <Progress value={phase === "analyzing" ? 100 : progress} className="mt-3" />
            <div className="mt-3 flex gap-2 text-xs text-muted-foreground">
              {["Upload", "Transcribe", "Analyze"].map((s, i) => (
                <span
                  key={s}
                  className={cn(
                    "rounded-md border px-2 py-0.5",
                    (phase === "analyzing" && i <= 2) || (phase === "uploading" && i === 0)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border",
                  )}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <Tabs defaultValue="transcript">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="file">Recording</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="connect">Connect</TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  onFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40",
                )}
              >
                <div className="flex gap-2 text-muted-foreground">
                  <FileVideo className="h-6 w-6" />
                  <FileAudio className="h-6 w-6" />
                </div>
                <div className="mt-3 text-sm font-medium">{fileName ?? "Drop a video or audio file"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Recording transcription isn&apos;t wired yet — use the Transcript tab to test the agents.
                </div>
                <input ref={inputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => onFiles(e.target.files)} />
              </div>
              <Button className="w-full" disabled={!fileName} onClick={() => simulate(fileName ?? "Recording")}>
                Upload &amp; analyze
              </Button>
            </TabsContent>

            <TabsContent value="transcript" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-title">Title</Label>
                <Input
                  id="t-title"
                  placeholder="e.g. Globex — Discovery"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-account">Customer</Label>
                <Input
                  id="t-account"
                  list="customer-suggestions"
                  placeholder="e.g. Acme Inc — links this meeting to the customer's history"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                />
                <datalist id="customer-suggestions">
                  {(customers ?? []).map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-body" className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Transcript
                </Label>
                <Textarea
                  id="t-body"
                  rows={6}
                  placeholder={"[00:00] Speaker 1: …\n[00:42] Speaker 2: …"}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
              </div>
              <Button className="w-full" disabled={!transcript.trim()} onClick={analyzeTranscript}>
                Analyze transcript
              </Button>
            </TabsContent>

            <TabsContent value="connect" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect a conferencing tool and Orbit will import every recording automatically.
              </p>
              {[
                { name: "Zoom", desc: "Auto-import cloud recordings" },
                { name: "Google Meet", desc: "Sync transcripts after each call" },
              ].map((c) => (
                <div key={c.name} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.desc}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => toast.success(`${c.name} connected`)}>
                    Connect
                  </Button>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
