"use client";

import * as React from "react";
import { toast } from "sonner";
import { Globe, Trash2 } from "lucide-react";
import { workspace } from "@/lib/auth";
import { OrbitMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
import { SectionHeader, FieldRow } from "./shared";

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "(GMT-07:00) Pacific Time" },
  { value: "America/New_York", label: "(GMT-04:00) Eastern Time" },
  { value: "Europe/London", label: "(GMT+01:00) London" },
  { value: "Europe/Berlin", label: "(GMT+02:00) Central European Time" },
  { value: "Asia/Tokyo", label: "(GMT+09:00) Tokyo" },
];

export function WorkspaceSection() {
  const [name, setName] = React.useState(workspace.name);
  const [slug, setSlug] = React.useState(workspace.slug);
  const [tz, setTz] = React.useState("Asia/Tokyo");
  const [region, setRegion] = React.useState("US");
  const [confirmName, setConfirmName] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const save = () => toast.success("Saved");

  return (
    <>
      <SectionHeader
        title="Workspace"
        description="General settings for your Orbit workspace."
        action={<Button onClick={save}>Save changes</Button>}
      />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <FieldRow label="Workspace logo" hint="Shown in the sidebar and on shared documents.">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card">
                <OrbitMark className="h-8 w-8" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => toast.success("Saved")}>
                  Upload
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => toast.success("Saved")}
                >
                  Remove
                </Button>
              </div>
            </div>
          </FieldRow>

          <Separator />

          <FieldRow label="Workspace name" htmlFor="ws-name" hint="The display name for your team.">
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
          </FieldRow>

          <Separator />

          <FieldRow label="Workspace URL" htmlFor="ws-slug" hint="Used for your unique workspace address.">
            <div className="flex items-center rounded-lg border border-input bg-background/40 focus-within:ring-2 focus-within:ring-ring/60">
              <span className="select-none border-r border-input px-3 py-2 text-sm text-muted-foreground">
                orbit.app/
              </span>
              <input
                id="ws-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="h-9 min-w-0 flex-1 rounded-r-lg bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </FieldRow>

          <Separator />

          <FieldRow label="Default timezone" hint="New meetings and schedules use this timezone.">
            <Select value={tz} onValueChange={setTz}>
              <SelectTrigger className="md:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          <Separator />

          <FieldRow
            label="Data region"
            hint="Where your meeting data and documents are stored at rest. Changing this triggers a migration."
          >
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="md:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">
                  <span className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5" /> United States (us-east-1)
                  </span>
                </SelectItem>
                <SelectItem value="EU">
                  <span className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5" /> European Union (eu-central-1)
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete this workspace</p>
              <p className="text-sm text-muted-foreground">
                Permanently remove {workspace.name}, all meetings, projects and documents. This cannot be undone.
              </p>
            </div>
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="shrink-0 gap-2">
                  <Trash2 className="h-4 w-4" /> Delete workspace
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete {workspace.name}?</DialogTitle>
                  <DialogDescription>
                    This permanently deletes the workspace and everything in it. Type{" "}
                    <span className="font-medium text-foreground">{workspace.name}</span> to confirm.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={workspace.name}
                  autoFocus
                />
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    disabled={confirmName !== workspace.name}
                    onClick={() => {
                      setDeleteOpen(false);
                      setConfirmName("");
                      toast.success("Workspace scheduled for deletion");
                    }}
                  >
                    Delete workspace
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
