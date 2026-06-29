"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      // Sonner v2 colors toasts via these CSS vars (they outrank utility classes),
      // so point them at the product's theme tokens instead of the default black.
      style={
        {
          "--normal-bg": "hsl(var(--card))",
          "--normal-text": "hsl(var(--foreground))",
          "--normal-border": "hsl(var(--border))",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-xl group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}
