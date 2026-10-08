// Language routing, checked at the HTTP level (no browser): the root is Czech, English lives under /en, slugs are localised,
// every other spelling of a page redirects permanently to the canonical address, and anything unknown answers 404.
// Same rules as src/proxy.ts and lib/routes.ts; the expected addresses come from routePath().
import { LOCALES, ROUTE_KEYS, routePath, type Locale, type RouteKey } from "../helpers/site";
import { ROUTES } from "../../src/lib/routes";
import type { APIResponse } from "@playwright/test";
import { expect, test } from "../helpers/test";


// the Location header is absolute ("<origin>/path?query"): keep path and query
const pathOf = (location: string | undefined) => (location ?? "").replace(/^[a-z]+:\/\/[^/]+/i, "");
const htmlLang = (html: string) => /<html[^>]*\blang="([^"]+)"/.exec(html)?.[1];
const prefix = (l: Locale) => (l === "cs" ? "" : "/en");

test.describe("canonical addresses @desktop", () => {
  for (const locale of LOCALES) {
    for (const key of ROUTE_KEYS) {
      test(`${routePath(locale, key)} answers 200 in ${locale}`, async ({ request }) => {
        const res = await request.get(routePath(locale, key), { maxRedirects: 0 });
        expect(res.status()).toBe(200);
        expect(res.headers()["content-type"]).toContain("text/html");
        expect(htmlLang(await res.text())).toBe(locale);
      });
    }
  }

  test("the root is Czech whatever the browser asks for; English only under /en", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" } });
    const res = await ctx.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(htmlLang(await res.text())).toBe("cs");
    await ctx.dispose();
  });
});

test.describe("other spellings redirect to the canonical address @desktop", () => {
  const cases: { from: string; to: string }[] = [];
  for (const locale of LOCALES) {
    const other: Locale = locale === "cs" ? "en" : "cs";
    for (const key of ROUTE_KEYS) {
      const canonical = routePath(locale, key);
      const slug = (l: Locale, k: RouteKey) => ROUTES[k].slugs[l];
      const spellings = key === "home"
        ? (locale === "cs" ? ["/cs"] : []) // "/cs" is the default language written out
        : [
            `${prefix(locale)}/${slug(other, key)}`, // the slug of the other language
            `${prefix(locale)}/${key}`, // the internal key typed by hand
            ...(locale === "cs" ? [`/cs/${slug("cs", key)}`, `/cs/${key}`] : []),
          ];
      for (const from of spellings) if (from !== canonical && !cases.some((c) => c.from === from)) cases.push({ from, to: canonical });
    }
  }
  for (const c of cases) {
    test(`${c.from} -> ${c.to}`, async ({ request }) => {
      const res = await request.get(c.from, { maxRedirects: 0 });
      expect(res.status(), `status of ${c.from}`).toBe(308);
      expect(pathOf(res.headers()["location"])).toBe(c.to);
    });
  }

  test("a redirect keeps the query string", async ({ request }) => {
    const res = await request.get(`/${ROUTES.plan.slugs.en}?utm=1`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(pathOf(res.headers()["location"])).toBe(`${routePath("cs", "plan")}?utm=1`);
  });
});

test.describe("unknown addresses answer 404 @desktop", () => {
  const unknown = [
    "/neexistuje",
    "/en/does-not-exist",
    "/xx/pudorys", // an unknown language prefix
    "/en/en",
  ];
  const expect404Page = async (res: APIResponse, path: string) => {
    expect(res.headers()["content-type"]).toContain("text/html");
    const html = await res.text();
    // a page inside the site layout in the language of the address that search engines are told to skip
    expect(htmlLang(html)).toBe(path.startsWith("/en") ? "en" : "cs");
    expect(html).toContain('class="nav');
    expect(html).toContain('<meta name="robots" content="noindex"');
  };
  for (const path of unknown) {
    test(`${path}`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
      await expect404Page(res, path);
    });
  }

  // KNOWN ISSUE: a known page with something appended is rewritten without the 404 status, so the 404 page is served as 200
  for (const path of [`${routePath("cs", "plan")}/extra`, `${routePath("en", "budget")}/extra/more`]) {
    test(`${path} (known issue: answers 200)`, async ({ request }, testInfo) => {
      const res = await request.get(path, { maxRedirects: 0 });
      await expect404Page(res, path);
      const fixed = res.status() === 404;
      testInfo.annotations.push({
        type: "known-issue",
        description: fixed ? "FIXED: move this path to the plain 404 cases" : "soft 404: status 200 (resolveRequest rewrites a known page with a tail without status 404)",
      });
      expect([200, 404]).toContain(res.status());
    });
  }

  test("a missing file in a public folder answers 404", async ({ request }) => {
    for (const path of ["/models/nothing.glb", "/media/nothing.jpg"]) expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  });
});
