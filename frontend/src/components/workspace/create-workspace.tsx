"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { useOrganizationList } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function errText(e: unknown, fallback: string): string {
  const err = e as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  return err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || fallback;
}

/** First run: a signed-in user with no organization creates one and becomes its
 *  admin. A workspace IS a Clerk organization; its data is fully isolated from
 *  every other company. Shown both on the onboarding gate (see RequireWorkspace)
 *  and in Settings → Members when there's no active org. */
export function CreateWorkspace({
  heading = "Create your workspace",
  subheading = "A workspace holds your company's memory, connections and members. Its data is fully isolated from every other workspace — nothing is shared across companies.",
}: {
  heading?: string;
  subheading?: string;
}) {
  const { createOrganization, setActive, isLoaded } = useOrganizationList();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !name.trim() || busy) return;
    setBusy(true);
    try {
      const org = await createOrganization({ name: name.trim() });
      await setActive({ organization: org.id });
      toast.success(`Created ${org.name}`);
    } catch (err) {
      toast.error(errText(err, "Couldn't create the workspace. Ensure Organizations are enabled in Clerk."));
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
