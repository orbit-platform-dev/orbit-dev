"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Mail, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useOrganization, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateWorkspace } from "@/components/workspace/create-workspace";
import { SectionHeader } from "./shared";

const ROLES = [
  { value: "org:admin", label: "Admin" },
  { value: "org:member", label: "Member" },
];
const roleLabel = (role: string) =>
  ROLES.find((r) => r.value === role)?.label ?? role.replace(/^org:/, "");

function errText(e: unknown, fallback: string): string {
  const err = e as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  return err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || fallback;
}

function InviteMemberDialog({
  workspaceName,
  onInvited,
}: {
  workspaceName: string;
  onInvited: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("org:member");
  const [busy, setBusy] = React.useState(false);

  const invite = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAddress: email.trim(), role, origin: window.location.origin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't send the invitation.");
      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail("");
      setOpen(false);
      onInvited();
    } catch (err) {
      toast.error(errText(err, "Couldn't send the invitation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone to {workspaceName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            They&apos;ll get an email with a link to join. When they accept, they sign in with their
            email, no password to set up.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">Work email</Label>
            <Input
              id="inv-email"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && invite()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={invite} disabled={!email.trim() || busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageMembers() {
  const { user } = useUser();
  const { organization, membership, memberships, invitations } = useOrganization({
    memberships: { keepPreviousData: true },
    invitations: { keepPreviousData: true },
  });
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const isAdmin = membership?.role === "org:admin";
  const workspaceName = organization?.name ?? "this workspace";

  const refresh = () => {
    memberships?.revalidate?.();
    invitations?.revalidate?.();
  };

  const removeMember = async (m: { id: string; destroy: () => Promise<unknown> }) => {
    setPendingId(m.id);
    try {
      await m.destroy();
      toast.success("Member removed");
      memberships?.revalidate?.();
    } catch (err) {
      toast.error(errText(err, "Couldn't remove that member."));
    } finally {
      setPendingId(null);
    }
  };

  const revokeInvite = async (inv: { id: string; revoke: () => Promise<unknown> }) => {
    setPendingId(inv.id);
    try {
      await inv.revoke();
      toast.success("Invitation revoked");
      invitations?.revalidate?.();
    } catch (err) {
      toast.error(errText(err, "Couldn't revoke that invitation."));
    } finally {
      setPendingId(null);
    }
  };

  const memberRows = memberships?.data ?? [];
  const inviteRows = (invitations?.data ?? []).filter((i) => i.status === "pending");
  const loading = memberships?.isLoading ?? true;

  return (
    <>
      <SectionHeader
        title="Members"
        description={`People with access to ${workspaceName}. Its memory, connections and data are isolated to this workspace.`}
        action={
          isAdmin ? (
            <InviteMemberDialog workspaceName={workspaceName} onInvited={refresh} />
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Members{memberRows.length ? ` · ${memberRows.length}` : ""}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {loading && memberRows.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            memberRows.map((m) => {
              const pd = m.publicUserData;
              const displayName =
                [pd?.firstName, pd?.lastName].filter(Boolean).join(" ") ||
                pd?.identifier ||
                "Member";
              const isSelf = pd?.userId === user?.id;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-accent/40"
                >
                  <UserAvatar name={displayName} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{displayName}</span>
                      {isSelf ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{pd?.identifier}</div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {m.role === "org:admin" ? (
                      <ShieldCheck className="h-3 w-3 text-primary" />
                    ) : null}
                    {roleLabel(m.role)}
                  </span>
                  {isAdmin && !isSelf ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={pendingId === m.id}
                      onClick={() => removeMember(m)}
                      aria-label={`Remove ${displayName}`}
                    >
                      {pendingId === m.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {inviteRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations · {inviteRows.length}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {inviteRows.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-accent/40"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{inv.emailAddress}</div>
                  <div className="text-xs text-muted-foreground">
                    Invited · {roleLabel(inv.role)}
                  </div>
                </div>
                {isAdmin ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={pendingId === inv.id}
                    onClick={() => revokeInvite(inv)}
                  >
                    {pendingId === inv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function MembersSection() {
  const { isLoaded, organization } = useOrganization();

  if (!isLoaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return organization ? <ManageMembers /> : <CreateWorkspace />;
}
