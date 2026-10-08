// Every page in both languages: it answers 200, has a title, one h1, a description, the right <html lang>, canonical and
// hreflang links, hydrates without console errors (the guard in helpers/test.ts) and does not scroll sideways.
import { LOCALE_META } from "../../src/lib/i18n/config";
import { SITE } from "../../src/lib/site-config";
import { knownIssue, noteKnown } from "../helpers/known-issues";
import { PAGES, alternatesOf, hasHorizontalScroll, open } from "../helpers/site";
import { expect, test } from "../helpers/test";

for (const p of PAGES) {
  test(`smoke: ${p.name}`, async ({ page }, testInfo) => {
    const response = await open(page, p.path);
    expect(response?.status(), "HTTP status").toBe(200);

    await expect(page.locator("html")).toHaveAttribute("lang", LOCALE_META[p.locale].htmlLang);
    expect((await page.title()).trim().length, "title").toBeGreaterThan(0);
    await expect(page.locator("h1:visible")).toHaveCount(1);
    expect((await page.locator("h1").first().innerText()).trim().length, "h1 text").toBeGreaterThan(0);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect((description ?? "").trim().length, "meta description").toBeGreaterThan(20);

    // canonical and the translations (the app builds them from the same routes module)
    const alt = alternatesOf(p.key);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new URL(p.path, `${SITE.url}/`).toString().replace(/\/$/, ""));
    for (const [locale, path] of Object.entries(alt)) {
      const href = new URL(path, `${SITE.url}/`).toString().replace(/\/$/, "");
      await expect(page.locator(`link[rel="alternate"][hreflang="${LOCALE_META[locale as keyof typeof LOCALE_META].htmlLang}"]`)).toHaveAttribute("href", href);
    }

    const scrolls = await hasHorizontalScroll(page);
    const known = knownIssue("overflow", { project: testInfo.project.name, locale: p.locale, key: p.key });
    if (known) noteKnown(testInfo, known, scrolls);
    else expect(scrolls, "the page scrolls sideways").toBe(false);
  });
}

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
