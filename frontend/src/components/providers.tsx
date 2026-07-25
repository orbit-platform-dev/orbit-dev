"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { initI18n } from "@/lib/i18n/client";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/i18n/config";

export function Providers({
  children,
  locale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  locale?: LocaleCode;
}) {
  const [i18n] = React.useState(() => initI18n(locale));
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // 401s after login are a Clerk-hydration race — let them recover.
            retry: (failureCount, error) =>
              String(error).includes("401") ? failureCount < 3 : failureCount < 1,
          },
        },
      }),
  );

  const tree = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );

  // ClerkProvider is applied once in app/layout.tsx (inside <body>).
  return tree;
}
