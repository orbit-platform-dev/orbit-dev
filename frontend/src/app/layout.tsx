import {ClerkProvider} from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Orbit · the AI Operating System Layer for companies",
    template: "%s · Orbit",
  },
  description:
    "Orbit is the AI Operating System Layer for companies: signals in, evidence-backed intelligence out. Humans approve; your tools stay the system of record.",
  icons: { icon: "/orbit-logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#080b14",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ClerkProvider
          appearance={{
            variables: { colorPrimary: "#6d5ef9" },
            layout: { unsafe_disableDevelopmentModeWarnings: true },
            elements: { footer: "hidden", logoBox: "hidden", badge: "hidden" },
          }}
        >
          <Providers locale={locale}>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}