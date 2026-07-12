"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { OrbitWordmark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const highlights = [
  {
    icon: Sparkles,
    title: "Signals in, intelligence out",
    desc: "Conversations, documents and tool data become company context Orbit reasons over, surfacing risks, gaps and what to do next.",
  },
  {
    icon: CheckCircle2,
    title: "You review, you approve",
    desc: "Everything is an editable draft. Nothing reaches a customer or a tool without your sign-off.",
  },
  {
    icon: RefreshCw,
    title: "Your tools stay in charge",
    desc: "Approved updates sync back into the tools your team already uses, which stay the system of record.",
  },
];

function clerkError(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  return (
    e?.errors?.[0]?.longMessage ||
    e?.errors?.[0]?.message ||
    "We couldn't sign you in. Orbit is invite-only — ask your workspace admin for access."
  );
}

/** Custom, Orbit-branded sign-in built on Clerk's headless `useSignIn` — no
 *  Clerk widget, no "Secured by Clerk". Invite-only: there is no self-serve
 *  sign-up (that route redirects here). */
export function AuthScreen() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await signIn.create({ identifier: email.trim(), password });
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        router.push("/feed");
      } else {
        setError("Extra verification is required. Please contact your workspace admin.");
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card/30 p-12 lg:flex">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-12 right-0 h-64 w-64 rounded-full bg-orbit-500/10 blur-3xl" />
        <div className="relative">
          <OrbitWordmark />
        </div>
        <div className="relative space-y-8">
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
            The <span className="text-gradient-brand">AI Operating System</span> for your company.
          </h1>
          <div className="space-y-5">
            {highlights.map((h, i) => (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.1 }}
                className="flex items-start gap-3"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <h.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">{h.title}</div>
                  <div className="text-sm text-muted-foreground">{h.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Orbit proposes · You approve · Your tools stay the system of record
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <OrbitWordmark />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in to Orbit</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Welcome back. Use your work email or Google.
          </p>

          <form className="mt-6 space-y-4" onSubmit={signInWithPassword}>
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
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full gap-2" disabled={!isLoaded || busy}>
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            OR
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full gap-2" onClick={signInWithGoogle} disabled={!isLoaded}>
            <GoogleMark /> Continue with Google
          </Button>

    
          {/* Clerk SMART CAPTCHA mounts here when required (bot protection). */}
          <div id="clerk-captcha" />
        </div>
      </div>
    </div>
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
