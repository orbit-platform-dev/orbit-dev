"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useMcpStatus, qk } from "@/lib/hooks";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className={cn("min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs", mono && "font-mono")}>
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// The plaintext key exists only in the generate response: render it once, never fetch it.
export function McpCard() {
  const qc = useQueryClient();
  const { data } = useMcpStatus();
  const [issued, setIssued] = useState<api.McpKeyIssued | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const configured = issued ? true : !!data?.configured;

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.mcp });
  const generate = useMutation({
    mutationFn: api.generateMcpKey,
    onSuccess: (d) => { setIssued(d); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not generate the key"),
  });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-border bg-muted/50 p-2"><Bot className="h-5 w-5" /></div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">AI agents (MCP)</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium",
                configured ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground")}>
                {configured ? "Active" : "Not set up"}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Give Claude Code, Cursor or any MCP client read access to this workspace&apos;s memory.
              One key for the whole workspace. Rotating or revoking it disconnects every agent using the old one.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {configured && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>Revoke</Button>
          )}
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            {generate.isPending ? "Generating…" : configured ? "Rotate key" : "Generate key"}
          </Button>
        </div>
      </div>

      {issued && (
        <div className="mt-4 space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
          <p className="text-xs font-medium text-primary">
            Shown once, copy it now. Orbit stores only a hash and cannot recover it.
          </p>
          <CopyField label="Workspace key" value={issued.key} />
          <CopyField label="Claude Code" value={issued.command} />
          <CopyField label="Endpoint (Cursor / other clients)" value={issued.endpoint} />
        </div>
      )}

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke the MCP key?"
        description="Every agent configured with this key loses access immediately. You can generate a new key at any time."
        confirmLabel="Revoke"
        onConfirm={async () => {
          await api.revokeMcpKey();
          setIssued(null);
          invalidate();
          toast.success("MCP key revoked");
        }}
      />
    </Card>
  );
}
