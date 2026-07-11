"use client";

// Customers — the entities everything else hangs off: signals, proposals
// plans and approved knowledge all belong to a customer.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Building2, CalendarDays, Handshake, Plus, Search, Sparkles, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useCustomers } from "@/lib/hooks";
import * as api from "@/lib/api";
import type { Customer } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function CustomersPage() {
  const { data: customers, isLoading } = useCustomers();
  const qc = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Customer | null>(null);

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteCustomer(deleteTarget.id);
      toast.success(`${deleteTarget.name} deleted`);
      for (const key of [qk.customers, qk.meetings, qk.projects]) {
        qc.invalidateQueries({ queryKey: key });
      }
    } catch (err) {
      toast.error("Couldn't delete the customer", { description: (err as Error).message });
      throw err;
    }
  };

  const filtered = (customers ?? []).filter((c) =>
    !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Every signal, proposal and piece of approved knowledge belongs to a customer."
        actions={
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New customer
          </Button>
        }
      />

      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers…" className="pl-9" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query ? "No customers match" : "No customers yet"}
          description={query ? "Try a different search." : "Create one, or add a signal — Orbit creates the customer automatically."}
          action={
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> New customer
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <CustomerCard customer={c} onDelete={() => setDeleteTarget(c)} />
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.name ?? "customer"}?`}
        description={<>Their knowledge base will be permanently removed. Signals and proposals are kept, just unlinked.</>}
        confirmLabel="Delete customer"
        destructive
        onConfirm={doDelete}
      />
      <NewCustomerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CustomerCard({ customer: c, onDelete }: { customer: Customer; onDelete: () => void }) {
  return (
    <Link href={`/customers/${c.id}`} className="glass glass-hover group relative block rounded-xl p-4 transition-all hover:-translate-y-0.5">
      {/* Always visible but quiet — turns red only when you aim at it. */}
      <button
        aria-label={`Delete ${c.name}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium">{c.name}</h3>
            {c.openCommitments > 0 && (
              <Badge variant="muted" className="gap-1 border-warning/40 text-warning">
                <Handshake className="h-3 w-3" /> {c.openCommitments} open
              </Badge>
            )}
          </div>
          {c.domains.length > 0 && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.domains.join(" · ")}</div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> {c.approvedPlanCount}/{c.planCount} proposals approved</span>
        {c.lastMeetingAt && (
          <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> last {timeAgo(c.lastMeetingAt)}</span>
        )}
      </div>
    </Link>
  );
}

function NewCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const c = await api.createCustomer({
        name: name.trim(), domain: domain.trim() || undefined, contactEmail: contactEmail.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: qk.customers });
      toast.success(`${c.name} created`);
      onOpenChange(false);
      setName(""); setDomain(""); setContactEmail("");
      router.push(`/customers/${c.id}`);
    } catch (err) {
      toast.error("Couldn't create the customer", { description: (err as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            Signals with a matching name (or email domain) link to this customer automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Company name</Label>
            <Input id="c-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-domain">Email domain <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="c-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-email">Contact email <span className="text-muted-foreground">(optional — auto-fills follow-ups)</span></Label>
            <Input id="c-email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="sarah@acme.com" />
          </div>
          <Button className="w-full" onClick={create} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create customer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
