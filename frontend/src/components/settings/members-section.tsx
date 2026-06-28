"use client";

import * as React from "react";
import { toast } from "sonner";
import { MoreHorizontal, UserPlus, Mail } from "lucide-react";
import type { Member } from "@/lib/types";
import { directory } from "@/lib/api";
import { workspace } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHeader } from "./shared";

const ROLES: Member["role"][] = ["Owner", "Admin", "Member", "Viewer"];

const statusMeta: Record<Member["status"], { label: string; variant: "success" | "info" | "muted" }> = {
  active: { label: "Active", variant: "success" },
  invited: { label: "Invited", variant: "info" },
  offline: { label: "Offline", variant: "muted" },
};

function InviteDialog() {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Member["role"]>("Member");

  const invite = () => {
    if (!email.trim()) {
      toast.error("Enter an email address");
      return;
    }
    setOpen(false);
    toast.success(`Invite sent to ${email}`);
    setEmail("");
    setRole("Member");
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
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>They&apos;ll receive an email invitation to join {workspace.name}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Member["role"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={invite}>Send invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembersSection() {
  const [members, setMembers] = React.useState<Member[]>(directory.members);

  const setRole = (id: string, role: Member["role"]) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
    toast.success("Role updated");
  };

  const remove = (m: Member) => {
    setMembers((prev) => prev.filter((x) => x.id !== m.id));
    toast.success(`Removed ${m.name}`);
  };

  const seatPct = Math.round((workspace.seatsUsed / workspace.seats) * 100);

  return (
    <>
      <SectionHeader
        title="Members"
        description="People with access to this workspace."
        action={<InviteDialog />}
      />

      {/* Seat usage */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Seat usage</p>
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums text-foreground">{workspace.seatsUsed}</span> of{" "}
              <span className="tabular-nums">{workspace.seats}</span> seats used on the {workspace.plan} plan.
            </p>
          </div>
          <div className="w-full sm:w-64">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{workspace.seatsUsed} active</span>
              <span className="tabular-nums">{seatPct}%</span>
            </div>
            <Progress value={seatPct} />
          </div>
        </CardContent>
      </Card>

      {/* Members list */}
      <Card>
        <CardContent className="p-0">
          {/* Header row (md+) */}
          <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_140px_120px_44px] items-center gap-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
            <span>Member</span>
            <span>Title</span>
            <span>Role</span>
            <span>Status</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const sm = statusMeta[m.status];
              return (
                <li
                  key={m.id}
                  className="grid grid-cols-[1fr_44px] items-center gap-3 px-5 py-3 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_140px_120px_44px] md:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={m.name} src={m.avatarUrl} className="h-9 w-9" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{m.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    </div>
                  </div>

                  <div className="hidden truncate text-sm text-muted-foreground md:block">{m.title}</div>

                  <div className="hidden md:block">
                    <Select
                      value={m.role}
                      onValueChange={(v) => setRole(m.id, v as Member["role"])}
                      disabled={m.role === "Owner"}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="hidden md:block">
                    <Badge variant={sm.variant}>{sm.label}</Badge>
                  </div>

                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => toast.success(`Resent invite to ${m.name}`)}>
                          Resend invite
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toast.success("Saved")}>
                          Edit permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => remove(m)}
                          disabled={m.role === "Owner"}
                          className={cn("text-destructive focus:text-destructive")}
                        >
                          Remove from workspace
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Mobile meta row */}
                  <div className="col-span-2 -mt-1 flex items-center gap-2 md:hidden">
                    <Badge variant={sm.variant}>{sm.label}</Badge>
                    <Badge variant="outline">{m.role}</Badge>
                    <span className="truncate text-xs text-muted-foreground">{m.title}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
