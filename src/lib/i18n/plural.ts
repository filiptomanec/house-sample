import type { Locale } from "./config";

export type PluralCategory = "one" | "few" | "other";

/**
 * Plural category of a count. Czech: 1 → one, 2–4 → few, everything else (0, 5+, fractions) → other.
 * English: 1 → one, everything else → other. Deliberately explicit instead of Intl.PluralRules,
 * so server, browser and tests always agree and fractions behave the way the dictionaries are written.
 */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  const abs = Math.abs(n);
  if (abs === 1) return "one";
  if (locale === "cs" && Number.isInteger(abs) && abs >= 2 && abs <= 4) return "few";
  return "other";
}
