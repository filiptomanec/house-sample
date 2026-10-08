// Routes of the site: keys, localised slugs, order and numbers, and the pure URL logic used by the proxy,
// the navigation, the language switch, the sitemap and the metadata.
//
// Public URLs are localised ("/pudorys", "/en/floor-plan"). The folders under src/app/[locale]/ are named after the
// route KEYS (plan, plot, ...). proxy.ts rewrites public URLs to key URLs ("/pudorys" -> "/cs/plan") and redirects
// every other spelling (wrong language, "/cs/...", "/en/plan") to the canonical public URL.

import { DEFAULT_LOCALE, LOCALES, isLocale, localePrefix, type Locale } from "./i18n/config";

export const ROUTE_KEYS = ["home", "model", "plan", "plot", "sun", "energy", "budget", "gallery"] as const;
export type RouteKey = (typeof ROUTE_KEYS)[number];
export type ToolKey = Exclude<RouteKey, "home">;

export type RouteDef = {
  /** Two-digit number of a tool page shown in headings and the menu ("01".."07"); "" for the home page (no "00"). */
  n: string;
  /** Public slug per locale ("" for the home page). */
  slugs: Record<Locale, string>;
  /** Sitemap priority. */
  priority: number;
  /**
   * The page loads the 3D engine (three.js, GLB files). Links to it are not prefetched in the viewport; the navigation
   * prefetches them on intent (pointer, focus, touch) instead. A property of the route, read instead of branching on keys.
   */
  heavy?: true;
};

/** In navigation order: 3D tour -> floor plan -> plot -> sun -> energy -> budget -> gallery. */
export const ROUTES: Record<RouteKey, RouteDef> = {
  home: { n: "", slugs: { cs: "", en: "" }, priority: 1 },
  model: { n: "01", slugs: { cs: "model", en: "model" }, priority: 0.9, heavy: true },
  plan: { n: "02", slugs: { cs: "pudorys", en: "floor-plan" }, priority: 0.8 },
  plot: { n: "03", slugs: { cs: "pozemek", en: "plot" }, priority: 0.8 },
  sun: { n: "04", slugs: { cs: "slunce", en: "sun" }, priority: 0.8, heavy: true },
  energy: { n: "05", slugs: { cs: "energie", en: "energy" }, priority: 0.7 },
  budget: { n: "06", slugs: { cs: "rozpocet", en: "budget" }, priority: 0.7 },
  gallery: { n: "07", slugs: { cs: "galerie", en: "gallery" }, priority: 0.7 },
};

export const TOOL_KEYS: readonly ToolKey[] = ROUTE_KEYS.filter((k): k is ToolKey => k !== "home");

export const isRouteKey = (v: unknown): v is RouteKey => typeof v === "string" && (ROUTE_KEYS as readonly string[]).includes(v);

const tailPath = (tail: readonly string[]) => (tail.length ? `/${tail.join("/")}` : "");

/** Public URL path: "/", "/pudorys", "/en", "/en/floor-plan". */
export function routePath(locale: Locale, key: RouteKey, tail: readonly string[] = []): string {
  const slug = ROUTES[key].slugs[locale];
  const path = `${localePrefix(locale)}${slug ? `/${slug}` : ""}${tailPath(tail)}`;
  return path || "/";
}

/** Internal URL path the page is served from: "/cs", "/cs/plan", "/en/plan". */
export function internalPath(locale: Locale, key: RouteKey, tail: readonly string[] = []): string {
  return `/${locale}${key === "home" ? "" : `/${key}`}${tailPath(tail)}`;
}

/** Route key of a slug in one locale, or null. */
export function keyForSlug(locale: Locale, slug: string): RouteKey | null {
  return ROUTE_KEYS.find((k) => k !== "home" && ROUTES[k].slugs[locale] === slug) ?? null;
}

const segmentsOf = (pathname: string) => pathname.split(/[?#]/)[0].split("/").filter(Boolean);

/** Reads a PUBLIC pathname as shown in the address bar. Null when it is not a canonical page URL (use resolveRequest for those). */
export function parsePublicPath(pathname: string): { locale: Locale; key: RouteKey; tail: string[] } | null {
  const segs = segmentsOf(pathname);
  const locale: Locale = segs[0] === "en" ? "en" : DEFAULT_LOCALE;
  if (locale !== DEFAULT_LOCALE) segs.shift();
  const [first, ...tail] = segs;
  if (first === undefined) return { locale, key: "home", tail: [] };
  const key = keyForSlug(locale, first);
  return key ? { locale, key, tail } : null;
}

/**
 * Like parsePublicPath, but also reads key URLs ("/cs/plan", "/en/plan"), in case the router reports the rewritten path.
 * Used by the navigation and the language switch to find the current page whichever form pathname comes in.
 */
export function parseAnyPath(pathname: string): { locale: Locale; key: RouteKey; tail: string[] } | null {
  const pub = parsePublicPath(pathname);
  if (pub) return pub;
  const [l, first, ...tail] = segmentsOf(pathname);
  if (!isLocale(l)) return null;
  if (first === undefined) return { locale: l, key: "home", tail: [] };
  return isRouteKey(first) && first !== "home" ? { locale: l, key: first, tail } : null;
}

/** Locale of a public pathname (by the /en prefix), also for pages that are not routes (404). */
export const localeOfPath = (pathname: string): Locale => (segmentsOf(pathname)[0] === "en" ? "en" : DEFAULT_LOCALE);

/** The same page in every language: { cs: "/pudorys", en: "/en/floor-plan" }. */
export function alternatePaths(key: RouteKey, tail: readonly string[] = []): Record<Locale, string> {
  return Object.fromEntries(LOCALES.map((l) => [l, routePath(l, key, tail)])) as Record<Locale, string>;
}

// ------------------------------------------------------------------------------------------- request resolution (proxy)

export type Resolution =
  | { type: "next" }
  | { type: "rewrite"; to: string; status?: number }
  | { type: "redirect"; to: string };

/**
 * Decides what the proxy does with a request path:
 * canonical public URL -> rewrite to the key URL, any other spelling of a known page -> redirect to the canonical URL,
 * unknown path -> rewrite into the locale with status 404. No route matches the target (there is no catch-all), so the
 * router serves app/global-not-found.tsx: a static page with full server HTML, never a streamed or client-rendered 404.
 */
export function resolveRequest(pathname: string): Resolution {
  const segs = segmentsOf(pathname);
  let locale: Locale = DEFAULT_LOCALE;
  let explicitDefault = false;
  if (segs[0] === "en") { locale = "en"; segs.shift(); }
  else if (segs[0] === DEFAULT_LOCALE) { explicitDefault = true; segs.shift(); }

  const [first, ...tail] = segs;
  let key: RouteKey | null = first === undefined ? "home" : keyForSlug(locale, first);
  if (!key && first !== undefined) {
    // a slug of the other language, or an internal key typed by hand
    const other = LOCALES.filter((l) => l !== locale).map((l) => keyForSlug(l, first)).find(Boolean) ?? null;
    const internal = isRouteKey(first) && first !== "home" ? first : null;
    const known = other ?? internal;
    if (known) return { type: "redirect", to: routePath(locale, known, tail) };
    return { type: "rewrite", to: `/${locale}/${segs.join("/")}`, status: 404 };
  }
  key = key ?? "home";
  if (explicitDefault) return { type: "redirect", to: routePath(locale, key, tail) };
  const to = internalPath(locale, key, tail);
  // a known page with something appended is not a page: serve the 404 page with status 404 (no soft 404)
  if (tail.length) return { type: "rewrite", to, status: 404 };
  const from = `/${segmentsOf(pathname).join("/")}`;
  return to === from ? { type: "next" } : { type: "rewrite", to };
}
