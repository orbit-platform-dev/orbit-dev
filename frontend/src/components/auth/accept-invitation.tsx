"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignUp } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";

function clerkError(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  return (
    e?.errors?.[0]?.longMessage ||
    e?.errors?.[0]?.message ||
    "This invitation link is invalid or has expired."
  );
}

export function AcceptInvitation() {
  const router = useRouter();
  const ticket = useSearchParams().get("__clerk_ticket");
  const { isLoaded, signUp, setActive } = useSignUp();
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const started = React.useRef(false);
  // Captured from the create() response so the click handler never reads a stale
  // hook value (the cause of "Continue does nothing").
  const createdSessionId = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isLoaded) return;
    if (!ticket) {
      router.replace("/sign-in");
      return;
    }
    if (started.current) return;
    started.current = true;
    signUp
      .create({ strategy: "ticket", ticket })
      .then((res) => {
        setEmail(res.emailAddress ?? "");
        if (res.status === "complete") {
          createdSessionId.current = res.createdSessionId ?? null;
          setPhase("ready");
        } else {
          setError("This invitation needs extra steps. Please contact your workspace admin.");
          setPhase("error");
        }
      })
      .catch((err) => {
        setError(clerkError(err));
        setPhase("error");
      });
  }, [isLoaded, ticket, signUp, router]);

  const enterWorkspace = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sid = createdSessionId.current ?? signUp?.createdSessionId ?? null;
      if (sid && setActive) await setActive({ session: sid });
      // Signed in now → /feed → first-run gate → create workspace.
      router.push("/feed");
    } catch (err) {
      setError(clerkError(err));
      setPhase("error");
      setBusy(false);
    }
  };

  if (!ticket) return null;

  return (
    <AuthShell>
      {phase === "loading" && (
        <>
          <h2 className="text-2xl font-semibold tracking-tight">Preparing your invitation…</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            One moment while we set up your access.
          </p>
        </>
      )}

      {phase === "error" && (
        <>
          <h2 className="text-2xl font-semibold tracking-tight">Invitation problem</h2>
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => router.push("/sign-in")}>
            Go to sign in
          </Button>
        </>
      )}

      {phase === "ready" && (
        <>
          <h2 className="text-2xl font-semibold tracking-tight">
            Welcome to Orbit{email ? `, ${email}` : ""}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your invitation is accepted. Next, set up your workspace.
          </p>
          <Button className="mt-6 w-full gap-2" onClick={enterWorkspace} disabled={busy}>
            {busy ? "Entering…" : "Continue"}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </Button>
        </>
      )}
    </AuthShell>
  );
}
