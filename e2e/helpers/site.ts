// What the tests know about the site: the pages (from the same routes module the app uses, so a renamed slug cannot make the suite
// lie), and small helpers for the navigation, which is a bar on wide screens and a menu on phones.
import type { Locator, Page, Response } from "@playwright/test";
import { LOCALES, type Locale } from "../../src/lib/i18n/config";
import { ROUTES, ROUTE_KEYS, TOOL_KEYS, alternatePaths, routePath, type RouteKey } from "../../src/lib/routes";

export { LOCALES, ROUTE_KEYS, TOOL_KEYS, alternatePaths as alternatesOf, routePath };
export type { Locale, RouteKey };

export interface PageInfo {
  locale: Locale;
  key: RouteKey;
  /** Public URL path, e.g. "/pudorys" or "/en/floor-plan". */
  path: string;
  /** For test titles. */
  name: string;
}

/** Every page in every language. */
export const PAGES: PageInfo[] = LOCALES.flatMap((locale) =>
  ROUTE_KEYS.map((key) => {
    const path = routePath(locale, key);
    return { locale, key, path, name: `${locale} ${path}` };
  }),
);

/** The pages whose content is a WebGL scene (three.js is loaded on these only): the routes marked heavy in routes.ts. */
export const SCENE_KEYS: readonly RouteKey[] = ROUTE_KEYS.filter((k) => ROUTES[k].heavy);

/**
 * Opens a page and waits until React has hydrated it: hydrated DOM nodes carry a "__reactFiber$..." property, so the header
 * (a client component) having one means the page responds to clicks. Returns the navigation response.
 */
export async function open(page: Page, path: string): Promise<Response | null> {
  const response = await page.goto(path, { waitUntil: "load" });
  await page.locator("main#content").waitFor({ state: "attached" });
  await page.waitForFunction(() => {
    const header = document.querySelector("header.nav");
    return !!header && Object.keys(header).some((k) => k.startsWith("__reactFiber$"));
  });
  return response;
}

/** The navigation as the visitor sees it: the bar (wide) or the opened menu (phone). Returns the container of the page links. */
export async function navigation(page: Page): Promise<Locator> {
  const toggle = page.locator(".nav-toggle");
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const menu = page.locator("#menu");
    await menu.waitFor();
    return menu;
  }
  return page.locator(".nav-links");
}

/** The links to the pages inside what `navigation()` returned (not the language links that the menu also holds). */
export const pageLinks = (nav: Locator): Locator => nav.locator("ol a, :scope > a");

/** The language switch that is on screen (header on wide screens, inside the menu on phones), and the link to the OTHER language. */
export async function otherLanguageLink(page: Page): Promise<Locator> {
  const toggle = page.locator(".nav-toggle");
  if (await toggle.isVisible()) await navigation(page);
  return page.locator(".lang:visible a:not([aria-current])").first();
}

/** True when the page scrolls sideways (anything wider than the window). */
export function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth + 1 || document.body.scrollWidth > d.clientWidth + 1;
  });
}

/** Phones and tablets (a touch screen as primary input). */
export const isTouch = (page: Page): Promise<boolean> => page.evaluate(() => matchMedia("(pointer: coarse)").matches);
