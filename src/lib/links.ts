// Navigation entries (label, description, number, URL) built from routes.ts and the "nav" dictionary.

import type { Locale } from "./i18n/config";
import type { T } from "./i18n/messages";
import { ROUTES, TOOL_KEYS, routePath, type RouteKey } from "./routes";

export type NavLink = { key: RouteKey; href: string; n: string; label: string; desc: string };

export function navLink(locale: Locale, key: RouteKey, t: T): NavLink {
  return {
    key,
    href: routePath(locale, key),
    n: ROUTES[key].n,
    label: t(`nav.items.${key}.label`),
    desc: t(`nav.items.${key}.desc`),
  };
}

/** The seven tool pages in navigation order. */
export const navLinks = (locale: Locale, t: T): NavLink[] => TOOL_KEYS.map((k) => navLink(locale, k, t));
