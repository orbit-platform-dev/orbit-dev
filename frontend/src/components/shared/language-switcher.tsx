"use client";

import { Check, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LOCALES, LOCALE_COOKIE, type LocaleCode } from "@/lib/i18n/config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.language as LocaleCode;

  const change = (code: LocaleCode) => {
    if (code === current) return;
    // Persist so the choice holds across navigation, refresh, and SSR.
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    i18n.changeLanguage(code); // live switch — every t() consumer re-renders, no reload
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("topbar.language")} title={t("topbar.language")}>
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l.code} onClick={() => change(l.code)} className="justify-between">
            {l.label}
            {current === l.code && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
