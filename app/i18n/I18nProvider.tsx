"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { LANG_COOKIE, localeFor, translate, type Lang, type MessageKey } from "./index";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  /** Locale code for Intl / toLocale*String. */
  locale: string;
  t: Translate;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Holds the interface language. The server layout reads the language cookie and passes it as
 * `initialLang`, so the first paint is already in the right language.
 */
export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    // One year; the cookie is what the server layout reads on the next load.
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      locale: localeFor(lang),
      t: (key, vars) => translate(lang, key, vars),
      setLang,
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
