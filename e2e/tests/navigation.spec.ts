// Navigation: the bar (wide) or the menu (phone) lists every page with the right address, marks the current one, the language
// switch keeps the route, and an unknown address gets the styled 404 page with a way out.
import { getT } from "../../src/lib/i18n/server";
import { LOCALES, ROUTE_KEYS, TOOL_KEYS, navigation, open, otherLanguageLink, pageLinks, routePath, type Locale } from "../helpers/site";
import { expect, test } from "../helpers/test";

const PATHNAME = (url: string) => new URL(url).pathname;

for (const locale of LOCALES) {
  test(`nav links: ${locale} lists every page with its address and marks the current one`, async ({ page }) => {
    await open(page, routePath(locale, "plan"));
    const nav = await navigation(page);
    const expected = page.viewportSize()!.width > 1180 ? TOOL_KEYS : ROUTE_KEYS; // the menu also has "home"
    const links = pageLinks(nav);
    await expect(links).toHaveCount(expected.length);
    for (const [i, key] of expected.entries()) await expect(links.nth(i)).toHaveAttribute("href", routePath(locale, key));
    await expect(pageLinks(nav).and(page.locator('[aria-current="page"]'))).toHaveAttribute("href", routePath(locale, "plan"));
  });

  // the English links are only clicked on the desktop; their addresses are checked on every device above
  test(`nav links: ${locale} every link leads to its page${locale === "en" ? " @desktop" : ""}`, async ({ page }) => {
    await open(page, routePath(locale, "home"));
    for (const key of TOOL_KEYS) {
      const nav = await navigation(page);
      await nav.locator(`a[href="${routePath(locale, key)}"]`).click();
      await expect(page).toHaveURL((u) => u.pathname === routePath(locale, key), { timeout: 30_000 });
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
  });
}

test("menu: opens, closes with Escape and returns focus to its toggle @mobile", async ({ page }) => {
  await open(page, "/");
  const toggle = page.locator(".nav-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#menu a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#menu")).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test("menu: following a link closes it and the page behind scrolls again @mobile", async ({ page }) => {
  await open(page, "/");
  const nav = await navigation(page);
  await nav.locator(`a[href="${routePath("cs", "gallery")}"]`).click();
  await expect(page).toHaveURL(/\/galerie$/);
  await expect(page.locator("#menu")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe("hidden");
});

// every page offers the same page in the other language: the addresses are read from the server markup (no browser needed)
test("language switch: every page links to the same page in the other language @desktop", async ({ request }) => {
  for (const key of ROUTE_KEYS) {
    for (const locale of LOCALES) {
      const html = await (await request.get(routePath(locale, key))).text();
      const links = [...html.matchAll(/<div class="lang"[^>]*>(.*?)<\/div>/gs)][0]?.[1] ?? "";
      const hrefs = [...links.matchAll(/<a [^>]*?href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs, `${locale} ${key}`).toEqual(LOCALES.map((l) => routePath(l, key)));
    }
  }
});

// the round trip is clicked through on three representative pages (the home page, a tool page and a WebGL page),
// because each click is a full page load
for (const key of ["home", "budget", "model"] as const) {
  test(`language switch: ${key} keeps the page when clicked (cs to en and back)`, async ({ page }) => {
    await open(page, routePath("cs", key));
    const toEn = await otherLanguageLink(page);
    await toEn.click();
    await page.waitForURL((u) => u.pathname === routePath("en", key), { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1:visible")).toHaveCount(1);

    const toCs = await otherLanguageLink(page);
    await expect(toCs).toHaveAttribute("href", routePath("cs", key));
    await toCs.click();
    await page.waitForURL((u) => u.pathname === routePath("cs", key), { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  });
}

for (const locale of LOCALES) {
  test.describe(`404 page (${locale})`, () => {
    test.use({ ignoreProblems: /^HTTP 404 |Failed to load resource.*404/ }); // the document itself is the expected 404
    const unknown = locale === "cs" ? "/tahle-stranka-neexistuje" : "/en/this-page-does-not-exist";

    test("an unknown address gets status 404 and a styled page with a way back", async ({ page }) => {
      const t = getT(locale as Locale);
      const response = await page.goto(unknown);
      expect(response?.status()).toBe(404);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("h1")).toHaveText(t("errors.notFound.title"));
      await expect(page.locator("header.nav")).toBeVisible(); // inside the site layout
      // links to every page, and the home button
      const links = page.locator(".state-links a");
      await expect(links).toHaveCount(TOOL_KEYS.length);
      for (const [i, key] of TOOL_KEYS.entries()) await expect(links.nth(i)).toHaveAttribute("href", routePath(locale, key));
      await page.locator(".state-actions a").click();
      await expect(page).toHaveURL((u) => PATHNAME(u.href) === routePath(locale, "home"));
      await expect(page.locator("h1")).toBeVisible();
    });

    test("the language switch on a 404 leads to the home page of the other language", async ({ page }) => {
      await page.goto(unknown);
      const other = await otherLanguageLink(page);
      await expect(other).toHaveAttribute("href", routePath(locale === "cs" ? "en" : "cs", "home"));
    });
  });
}
