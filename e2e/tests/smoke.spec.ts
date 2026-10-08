// Every page in both languages: it answers 200, has a title, one h1, a description, the right <html lang>, canonical and
// hreflang links, hydrates without console errors (the guard in helpers/test.ts) and does not scroll sideways. The server
// HTML alone is a complete page: the h1 inside <main>, no streamed boundary that a script must fill in later.
import { DEFAULT_LOCALE, LOCALE_META } from "../../src/lib/i18n/config";
import { canonicalUrl } from "../../src/lib/site-config";
import { PAGES, alternatesOf, hasHorizontalScroll, open } from "../helpers/site";
import { expect, test } from "../helpers/test";

for (const p of PAGES) {
  test(`smoke: ${p.name}`, async ({ page }) => {
    const response = await open(page, p.path);
    expect(response?.status(), "HTTP status").toBe(200);

    await expect(page.locator("html")).toHaveAttribute("lang", LOCALE_META[p.locale].htmlLang);
    expect((await page.title()).trim().length, "title").toBeGreaterThan(0);
    await expect(page.locator("h1:visible")).toHaveCount(1);
    expect((await page.locator("h1").first().innerText()).trim().length, "h1 text").toBeGreaterThan(0);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect((description ?? "").trim().length, "meta description").toBeGreaterThan(20);

    // canonical and the translations (the app builds them from the same routes module), one URL form (no trailing slash)
    const alt = alternatesOf(p.key);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonicalUrl(p.path));
    for (const [locale, path] of Object.entries(alt)) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${LOCALE_META[locale as keyof typeof LOCALE_META].hreflang}"]`)).toHaveAttribute("href", canonicalUrl(path));
    }
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", canonicalUrl(alt[DEFAULT_LOCALE]));

    expect(await hasHorizontalScroll(page), "the page scrolls sideways").toBe(false);
  });
}

test("smoke: the server HTML of every page is complete (h1 inside main, nothing streamed) @desktop", async ({ request }) => {
  for (const p of PAGES) {
    const res = await request.get(p.path);
    expect(res.status(), p.name).toBe(200);
    const html = await res.text();
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
    expect(main, `${p.name}: <main> holds the page heading`).toMatch(/<h1\b/);
    const footer = html.indexOf("<footer");
    if (footer >= 0) expect(html.indexOf("<h1"), `${p.name}: the page heading comes before the footer`).toBeLessThan(footer);
    expect(html, `${p.name}: a Suspense boundary waits for streamed content`).not.toContain('<template id="B:');
    expect(html, `${p.name}: the page is rendered on the client only`).not.toContain('id="__next_error__"');
  }
});

test("smoke: titles are unique within a language @desktop", async ({ request }) => {
  // plain HTTP: the titles come from the server markup
  const titles = new Map<string, string[]>();
  for (const p of PAGES) {
    const res = await request.get(p.path);
    const html = await res.text();
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    titles.set(p.locale, [...(titles.get(p.locale) ?? []), title]);
  }
  for (const [locale, list] of titles) expect(new Set(list).size, `${locale}: titles ${JSON.stringify(list)}`).toBe(list.length);
});
