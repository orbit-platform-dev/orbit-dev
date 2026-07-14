"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { useOrganizationList } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** First run for a superadmin with no workspace: create one and become its admin.
 *  A workspace IS a Clerk organization; its data is fully isolated. Creation goes
 *  through the superadmin-gated server route, not the client SDK. (Customers never
 *  see this; they are provisioned directly into their workspace.) */
export function CreateWorkspace({
  heading = "Create your workspace",
  subheading = "A workspace holds a company's memory, connections and members. Its data is fully isolated from every other workspace.",
}: {
  heading?: string;
  subheading?: string;
}) {
  const { setActive, userMemberships, isLoaded } = useOrganizationList({ userMemberships: true });
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error || "Couldn't create the workspace.");
      await userMemberships?.revalidate?.();
      await setActive?.({ organization: data.id });
      qc.clear();
      toast.success(`Created ${data.name}`);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't create the workspace.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        {subheading ? <p className="text-sm text-muted-foreground">{subheading}</p> : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end" onSubmit={create}>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input
                id="ws-name"
                placeholder="Acme Inc"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" className="gap-2" disabled={!isLoaded || !name.trim() || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create workspace
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
