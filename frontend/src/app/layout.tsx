import {ClerkProvider} from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Orbit · the AI Operating System for companies",
    template: "%s · Orbit",
  },
  description:
    "Orbit is the AI Operating System for companies: signals in, evidence-backed intelligence out. Humans approve; your tools stay the system of record.",
  icons: { icon: "/orbit-logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#080b14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ClerkProvider
          appearance={{
            variables: { colorPrimary: "#6d5ef9" },
            layout: { unsafe_disableDevelopmentModeWarnings: true },
            elements: { footer: "hidden", logoBox: "hidden", badge: "hidden" },
          }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}