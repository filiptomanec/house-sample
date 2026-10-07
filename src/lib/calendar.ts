// Month and day names per language (via Intl, no hand-written tables) and month lengths. No dependencies on the model,
// so pages without energy data can import them too.

import { LOCALE_META, type Locale } from "./i18n/config";
import { nb } from "./i18n/format";

/** Days per month of a non-leap year (energy and sun calculations use a typical year). */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export type MonthWidth = "long" | "short" | "narrow";

const cache = new Map<string, readonly string[]>();

/** Month names, index 0 = January. Standalone forms ("březen"); "short" is "led" / "Jan", "narrow" a single letter. */
export function monthNames(locale: Locale, width: MonthWidth = "long"): readonly string[] {
  const k = `${locale}:${width}`;
  let v = cache.get(k);
  if (!v) {
    const f = new Intl.DateTimeFormat(LOCALE_META[locale].intl, { month: width, timeZone: "UTC" });
    v = Array.from({ length: 12 }, (_, m) => f.format(new Date(Date.UTC(2001, m, 15))));
    cache.set(k, v);
  }
  return v;
}

/** Day and month as written in a sentence: "15. března" / "15 March". `month` is 0-based. */
export function dayMonth(locale: Locale, month: number, day: number): string {
  const f = new Intl.DateTimeFormat(LOCALE_META[locale].intl, { day: "numeric", month: "long", timeZone: "UTC" });
  return nb(f.format(new Date(Date.UTC(2001, month, day))), locale);
}

/** Weekday names, index 0 = Monday. */
export function weekdayNames(locale: Locale, width: "long" | "short" = "long"): readonly string[] {
  const k = `${locale}:wd:${width}`;
  let v = cache.get(k);
  if (!v) {
    const f = new Intl.DateTimeFormat(LOCALE_META[locale].intl, { weekday: width, timeZone: "UTC" });
    v = Array.from({ length: 7 }, (_, d) => f.format(new Date(Date.UTC(2001, 0, 1 + d)))); // 1 Jan 2001 was a Monday
    cache.set(k, v);
  }
  return v;
}

/** Day of the year (1-based) of a month (0-based) and day in a non-leap year. */
export function dayOfYear(month: number, day: number): number {
  return DAYS_IN_MONTH.slice(0, month).reduce((a, b) => a + b, 0) + day;
}
