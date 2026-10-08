import type { MetadataRoute } from "next";
import { media } from "@/lib/data/media";
import { DEFAULT_LOCALE, LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { ROUTES, ROUTE_KEYS, routePath, type RouteKey } from "@/lib/routes";
import { canonicalUrl } from "@/lib/site-config";

/**
 * When the content last changed: the build date the media pipeline writes into public/media/manifest.json (`builtAt`,
 * an ISO date), or nothing. Never the clock: the sitemap must not change on every build (ARCHITECTURE §1).
 */
function contentDate(m: object = media): string | undefined {
  const v = "builtAt" in m ? m.builtAt : undefined;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : undefined;
}

/** The translations of a page for hreflang, plus x-default (the default language, also served at the root URLs). */
function languages(key: RouteKey): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].hreflang, canonicalUrl(routePath(l, key))]));
  out["x-default"] = canonicalUrl(routePath(DEFAULT_LOCALE, key));
  return out;
}

/** Every page in both languages, each entry listing its translations. URLs in the pages' canonical form. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = contentDate();
  return ROUTE_KEYS.flatMap((key) =>
    LOCALES.map((locale) => ({
      url: canonicalUrl(routePath(locale, key)),
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: key === "home" ? ("monthly" as const) : ("yearly" as const),
      priority: ROUTES[key].priority,
      alternates: { languages: languages(key) },
    })),
  );
}
