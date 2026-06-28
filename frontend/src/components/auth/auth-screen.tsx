"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Bot, GitBranch, ShieldCheck, Sparkles } from "lucide-react";
import { OrbitWordmark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clerkEnabled } from "@/lib/auth";

const highlights = [
  { icon: Sparkles, title: "Meetings → shipped features", desc: "Every call becomes PRDs, plans, and tasks automatically." },
  { icon: Bot, title: "A team of 8 AI agents", desc: "Product, engineering, design, QA, sales — working in concert." },
  { icon: GitBranch, title: "Live execution graph", desc: "Watch work flow from conversation to deployment in real time." },
];

export function AuthScreen({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  function ClerkForm() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clerk = require("@clerk/nextjs");
    const C = isSignUp ? Clerk.SignUp : Clerk.SignIn;
    return <C routing="path" path={isSignUp ? "/sign-up" : "/sign-in"} signInUrl="/sign-in" forceRedirectUrl="/dashboard" />;
  }

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
            Turn every customer conversation into <span className="text-gradient-brand">shipped product.</span>
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
          SOC 2 Type II · SAML SSO · End-to-end encrypted
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <OrbitWordmark />
          </div>

          {clerkEnabled ? (
            <ClerkForm />
          ) : (
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {isSignUp ? "Create your workspace" : "Welcome back"}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {isSignUp ? "Start turning meetings into momentum." : "Sign in to continue to Orbit."}
              </p>

              <form
                className="mt-6 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  router.push("/dashboard");
                }}
              >
                {isSignUp && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Full name</Label>
                    <Input id="name" placeholder="Yash Pandey" autoComplete="name" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" type="email" placeholder="you@company.com" defaultValue="yash@batton.co.jp" autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" placeholder="••••••••••" defaultValue="demo-password" autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full gap-2">
                  {isSignUp ? "Create workspace" : "Continue to workspace"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                OR
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => router.push("/dashboard")}>Google</Button>
                <Button variant="outline" onClick={() => router.push("/dashboard")}>SAML SSO</Button>
              </div>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {isSignUp ? "Already have an account? " : "New to Orbit? "}
                <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-medium text-primary hover:underline">
                  {isSignUp ? "Sign in" : "Create an account"}
                </Link>
              </p>
              <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
                Demo mode — any credentials continue. Add Clerk keys to enable real auth.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
