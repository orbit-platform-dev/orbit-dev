"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { clerkEnabled } from "@/lib/auth";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const tree = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );

  // Wrap with Clerk only when configured, so the app runs with zero setup.
  if (clerkEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ClerkProvider } = require("@clerk/nextjs");
    return (
      <ClerkProvider appearance={{ variables: { colorPrimary: "#3358f4" } }}>{tree}</ClerkProvider>
    );
  }

  return tree;
}
