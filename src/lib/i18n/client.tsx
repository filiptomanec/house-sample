"use client";

// Client side of i18n: a provider that holds the locale and the dictionaries the server handed over, and hooks.
// Providers nest: a page can add its own namespaces below the layout's (common, nav, footer, errors).

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { getFormatter, type Formatter } from "./format";
import type { Namespace, T } from "./messages";
import { createT, type Tree } from "./translate";

type Loaded = Partial<Record<Namespace, Tree>>;
type Ctx = { locale: Locale; messages: Loaded; t: T; format: Formatter };

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Loaded; children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo<Ctx>(() => {
    const merged = parent && parent.locale === locale ? { ...parent.messages, ...messages } : messages;
    return { locale, messages: merged, t: createT(locale, merged) as T, format: getFormatter(locale) };
  }, [locale, messages, parent]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): Ctx {
  const v = useContext(I18nContext);
  if (!v) throw new Error("i18n: no <I18nProvider> above this component (the [locale] layout provides one)");
  return v;
}

/** Current locale. */
export const useLocale = (): Locale => useI18n().locale;
/** Translator for the namespaces loaded by the layout and the page. */
export const useT = (): T => useI18n().t;
/** Number, unit, time and money formatting for the current locale. */
export const useFormat = (): Formatter => useI18n().format;
