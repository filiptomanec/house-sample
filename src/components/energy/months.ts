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
