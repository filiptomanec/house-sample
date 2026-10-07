// Server side of i18n: a translator with every namespace (the server holds all dictionaries in memory anyway).

import type { Locale } from "./config";
import { MESSAGES, type T } from "./messages";
import { createT } from "./translate";

const cache = new Map<Locale, T>();

/** Translator for server components, route metadata and the sitemap. */
export function getT(locale: Locale): T {
  let t = cache.get(locale);
  if (!t) {
    const messages = Object.fromEntries(Object.entries(MESSAGES).map(([ns, m]) => [ns, m[locale]]));
    cache.set(locale, (t = createT(locale, messages) as T));
  }
  return t;
}
