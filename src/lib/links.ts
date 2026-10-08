// Navigation entries (label, description, number, URL) built from routes.ts and the "nav" dictionary.

import type { Locale } from "./i18n/config";
import type { T } from "./i18n/messages";
import { ROUTES, TOOL_KEYS, routePath, type RouteKey } from "./routes";

export type NavLink = {
  key: RouteKey;
  href: string;
  /** "01".."07" for the tools, "" for the home page: render the number only when it is not empty. */
  n: string;
  label: string;
  desc: string;
  /** The page loads the 3D engine: render the link with prefetch={false} and prefetch it on intent (ROUTES[key].heavy). */
  heavy: boolean;
};

export function navLink(locale: Locale, key: RouteKey, t: T): NavLink {
  return {
    key,
    href: routePath(locale, key),
    n: ROUTES[key].n,
    label: t(`nav.items.${key}.label`),
    desc: t(`nav.items.${key}.desc`),
    heavy: ROUTES[key].heavy === true,
  };
}

/** The seven tool pages in navigation order (the 3D tour first). */
export const navLinks = (locale: Locale, t: T): NavLink[] => TOOL_KEYS.map((k) => navLink(locale, k, t));

/** Fragment id of the "About the project" section on the home page, per locale (the menu's "O projektu" / "About" entry). */
export const ABOUT_ANCHOR: Record<Locale, string> = { cs: "o-projektu", en: "about" };

/** URL of the "About the project" section: "/#o-projektu", "/en#about". Not a route: the sitemap and the proxy ignore it. */
export const aboutHref = (locale: Locale): string => `${routePath(locale, "home")}#${ABOUT_ANCHOR[locale]}`;
