"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { AuthShell } from "./auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function clerkError(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string; code?: string }[] };
  const first = e?.errors?.[0];
  // Invite-only: an unknown identifier means no account exists.
  if (first?.code === "form_identifier_not_found") {
    return "No Orbit account found for that email. Orbit is invite-only — ask your workspace admin for access.";
  }
  return first?.longMessage || first?.message || "Something went wrong. Please try again.";
}

/**
 * Custom, Orbit-branded sign-in on Clerk's headless `useSignIn` — no Clerk widget.
 * Passwordless + invite-only: email one-time code (primary) or Google. There is
 * no self-serve sign-up (that route redirects here).
 */
export function AuthScreen() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Step 1 — look up the account and email a one-time code.
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await signIn.create({ identifier: email.trim() });
      const factor = res.supportedFirstFactors?.find(
        (f): f is Extract<typeof f, { strategy: "email_code" }> => f.strategy === "email_code",
      );
      if (!factor) {
        setError("This account can't sign in with an email code. Try Google, or contact your admin.");
        return;
      }
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      setStep("code");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setBusy(false);
    }
  };

  // Step 2 — verify the code and start the session.
  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() });
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        router.push("/feed");
      } else {
        setError(`Sign-in couldn't complete (status: ${res.status}).`);
      }
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!isLoaded || busy) return;
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/feed",
      });
    } catch (err) {
      setError(clerkError(err));
    }
  };

  return (
    <AuthShell>
      <h2 className="text-2xl font-semibold tracking-tight">Sign in to Orbit</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {step === "email" ? "Use your work email or Google." : `Enter the 6-digit code we emailed to ${email}.`}
      </p>

      {step === "email" ? (
        <>
          <form className="mt-6 space-y-4" onSubmit={sendCode}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" className="w-full gap-2" disabled={!isLoaded || busy}>
              {busy ? "Sending code…" : "Continue with email"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full gap-2" onClick={signInWithGoogle} disabled={!isLoaded}>
            <GoogleMark /> Continue with Google
          </Button>
        </>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={verifyCode}>
          <div className="space-y-1.5">
            <Label htmlFor="code">Sign-in code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" className="w-full gap-2" disabled={!isLoaded || busy}>
            {busy ? "Verifying…" : "Verify & sign in"}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </Button>
          <button
            type="button"
            onClick={() => { setStep("email"); setCode(""); setError(null); }}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Use a different email
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Orbit is invite-only. Ask your workspace admin for access.
      </p>
      {/* Bot-protection mount point (harmless when disabled). */}
      <div id="clerk-captcha" />
    </AuthShell>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
