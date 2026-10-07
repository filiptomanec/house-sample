// Formatting that the shared Formatter does not offer: a calendar day without a year ("21. června", "21 June").

import { LOCALE_META, nb, type Locale } from "@/lib/i18n";
import type { CalendarDate } from "@/lib/calc/sun";

const formatters = new Map<Locale, Intl.DateTimeFormat>();

/** Day and month of a calendar date (month 0-based) in the language, with the Czech non-breaking spaces. */
export function dayMonth(locale: Locale, date: CalendarDate): string {
  let f = formatters.get(locale);
  if (!f) formatters.set(locale, (f = new Intl.DateTimeFormat(LOCALE_META[locale].intl, { day: "numeric", month: "long", timeZone: "UTC" })));
  return nb(f.format(Date.UTC(date.year, date.month, date.day)), locale);
}
