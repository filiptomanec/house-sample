import { monthNames } from "@/lib/calendar";
import type { Locale } from "@/lib/i18n/config";

/**
 * Short month names for chart labels and buttons. English takes the first three letters of the long name: the short form from
 * Intl is "Sept" in Node but "Sep" in Safari, which makes server and browser markup differ (a hydration error). The
 * Czech short forms are the same in both engines.
 */
export function shortMonths(locale: Locale): readonly string[] {
  return locale === "en" ? monthNames(locale, "long").map((m) => m.slice(0, 3)) : monthNames(locale, "short");
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

/**
 * Month labels of a narrow chart axis (about 24 px per month). Czech writes months as Roman numerals (I–XII: short, unambiguous
 * and idiomatic, like "1. IV."); English keeps its three-letter names, which fit the same room. The full name goes into the
 * accessible name of each month, never only these.
 */
export function narrowMonths(locale: Locale): readonly string[] {
  return locale === "cs" ? ROMAN : shortMonths(locale);
}

/** "květen–září" / "May–September": a season given as 0-based months (first and last), in the long form. */
export function monthSpan(locale: Locale, months: readonly number[]): string {
  if (months.length === 0) return "";
  const long = monthNames(locale, "long");
  const first = Math.min(...months), last = Math.max(...months);
  return first === last ? long[first] : `${long[first]}\u{2013}${long[last]}`;
}
