"use client";

// Import Google Meet conference records: each one's transcript entries become a
// Meeting and run the analysis pipeline. Shown only when Meet is connected.
// Meet records have no topic, so a Customer field links the import to the right
// customer's history (autocompletes existing customers).

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Clock, CloudDownload, FileText, Loader2 } from "lucide-react";
import { qk, useCustomers, useMeetRecordings } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { ZoomRecording } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function MeetImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: recordings, isLoading } = useMeetRecordings(open);
  const { data: customers } = useCustomers();
  const [account, setAccount] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Google Meet</DialogTitle>
          <DialogDescription>
            Recent meetings with transcripts. Importing turns the transcript into a meeting and analyzes it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="meet-account">Customer</Label>
          <Input
            id="meet-account"
            list="meet-customer-suggestions"
            placeholder="e.g. Acme Inc — links the import to the customer's history"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
          <datalist id="meet-customer-suggestions">
            {(customers ?? []).map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : !recordings || recordings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No recent Meet conference records. Transcripts need a Google Workspace plan with
            transcription turned on during the call.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {recordings.map((r) => (
              <RecordRow key={r.uuid} recording={r} account={account} onDone={() => onOpenChange(false)} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordRow({ recording: r, account, onDone }: { recording: ZoomRecording; account: string; onDone: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [importing, setImporting] = React.useState(false);

  const doImport = async () => {
    setImporting(true);
    try {
      const res = await api.importMeetRecording(r.uuid, account.trim() || undefined);
      toast.success("Meeting imported — analyzing now");
      qc.invalidateQueries({ queryKey: qk.meetings });
      qc.invalidateQueries({ queryKey: qk.meetRecordings });
      qc.invalidateQueries({ queryKey: qk.customers });
      onDone();
      router.push(`/meetings/${res.meetingId}`);
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
      setImporting(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{r.topic}</span>
          {r.hasTranscript ? (
            <Badge variant="muted" className="gap-1 text-[10px]"><FileText className="h-3 w-3" /> transcript</Badge>
          ) : (
            <Badge variant="muted" className="text-[10px] text-warning">no transcript</Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {r.startTime && <span>{formatDate(r.startTime)} · {formatTime(r.startTime)}</span>}
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{r.durationMin} min</span>
        </div>
      </div>
      {r.meetingId ? (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
          onClick={() => { onDone(); router.push(`/meetings/${r.meetingId}`); }}>
          Imported <ArrowUpRight className="h-3 w-3" />
        </Button>
      ) : (
        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={doImport} disabled={importing || !r.hasTranscript}>
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
          Import & analyze
        </Button>
      )}
    </div>
  );
}
