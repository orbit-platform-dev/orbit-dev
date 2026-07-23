"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, type LocaleCode } from "./config";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

// Register each language's messages here (step 3 of adding a language).
const resources = {
  en: { translation: en },
  ja: { translation: ja },
};

let started = false;

// Idempotent: the provider calls this on every render; we init once, then only
// switch language if the (cookie-seeded) locale changed. Seeding with the same
// value the server used for <html lang> keeps SSR and hydration in agreement.
export function initI18n(locale: LocaleCode) {
  if (!started) {
    i18n.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    started = true;
  } else if (i18n.language !== locale) {
    i18n.changeLanguage(locale);
  }
  return i18n;
}

export default i18n;
