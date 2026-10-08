// Locales of the site. Czech is the default and lives on root URLs; English lives under /en (see routes.ts, proxy.ts).

export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const LOCALE_META: Record<Locale, {
  /** Value of <html lang> and the lang attribute of a link to the language: the dialect the text is written in. */
  htmlLang: string;
  /**
   * Language tag of the alternate links (hreflang in the metadata, the sitemap and the language switch). Language only,
   * so that every English reader, not only a British one, is sent to the English pages.
   */
  hreflang: string;
  /** BCP 47 tag handed to Intl. */
  intl: string;
  /** Open Graph locale. */
  og: string;
  /** Short label of the language switch. */
  short: string;
  /** Name of the language in that language. */
  name: string;
}> = {
  cs: { htmlLang: "cs", hreflang: "cs", intl: "cs-CZ", og: "cs_CZ", short: "CS", name: "Čeština" },
  // the English pages are written in UK English (docs/COPY.md)
  en: { htmlLang: "en-GB", hreflang: "en", intl: "en-GB", og: "en_GB", short: "EN", name: "English" },
};

/** The other language (there are exactly two). */
export const otherLocale = (l: Locale): Locale => (l === "cs" ? "en" : "cs");

/** URL prefix of a locale: "" for the default one, "/en" otherwise. */
export const localePrefix = (l: Locale): string => (l === DEFAULT_LOCALE ? "" : `/${l}`);
