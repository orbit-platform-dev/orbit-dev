"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsSuperadmin } from "@/lib/use-superadmin";
import { SectionHeader } from "./shared";

function errText(e: unknown, fallback: string): string {
  const err = e as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  return err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || fallback;
}

/** Superadmin-only. Sends a Clerk invitation email to the customer. When they
 *  accept they land on Orbit's own page, sign in, and create their OWN workspace.
 *  The vendor is never involved in that workspace. */
export function InviteCustomer() {
  const isSuperadmin = useIsSuperadmin();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [invited, setInvited] = React.useState<string | null>(null);

  // Customers never see this tool.
  if (!isSuperadmin) return null;

  const invite = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAddress: email.trim(), origin: window.location.origin }),
      });
      const data = (await res.json().catch(() => ({}))) as { email?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't send the invitation.");
      setInvited(data.email || email.trim());
      setEmail("");
    } catch (err) {
      toast.error(errText(err, "Couldn't send the invitation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Invite a customer"
        description="Send an invitation email. They accept, sign in, and create their own workspace. You never get access to their data."
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="cust-email">Customer&apos;s email</Label>
              <Input
                id="cust-email"
                type="email"
                placeholder="founder@customer.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && invite()}
              />
            </div>
            <Button onClick={invite} disabled={!email.trim() || busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send invite
            </Button>
          </div>

          {invited ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-accent/30 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Invitation sent to {invited}.</p>
                <p className="mt-1 text-muted-foreground">
                  They&apos;ll get an email with a link to join. When they accept, they sign in and
                  create their own workspace.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
