import type { MetadataRoute } from "next";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { ROUTES, ROUTE_KEYS, routePath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-config";

/** Every page in both languages, each entry listing its translations (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTE_KEYS.flatMap((key) =>
    LOCALES.map((locale) => ({
      url: absoluteUrl(routePath(locale, key)),
      lastModified,
      changeFrequency: key === "home" ? ("monthly" as const) : ("yearly" as const),
      priority: ROUTES[key].priority,
      alternates: { languages: Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].htmlLang, absoluteUrl(routePath(l, key))])) },
    })),
  );
}
