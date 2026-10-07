// Locales of the site. Czech is the default and lives on root URLs; English lives under /en (see routes.ts, proxy.ts).

export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const LOCALE_META: Record<Locale, {
  /** Value of <html lang> and hreflang. */
  htmlLang: string;
  /** BCP 47 tag handed to Intl. */
  intl: string;
  /** Open Graph locale. */
  og: string;
  /** Short label of the language switch. */
  short: string;
  /** Name of the language in that language. */
  name: string;
}> = {
  cs: { htmlLang: "cs", intl: "cs-CZ", og: "cs_CZ", short: "CS", name: "Čeština" },
  en: { htmlLang: "en", intl: "en-GB", og: "en_GB", short: "EN", name: "English" },
};

/** The other language (there are exactly two). */
export const otherLocale = (l: Locale): Locale => (l === "cs" ? "en" : "cs");

/** URL prefix of a locale: "" for the default one, "/en" otherwise. */
export const localePrefix = (l: Locale): string => (l === DEFAULT_LOCALE ? "" : `/${l}`);
