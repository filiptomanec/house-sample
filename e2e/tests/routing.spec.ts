// Language routing, checked at the HTTP level (no browser): the root is Czech, English lives under /en, slugs are localised,
// every other spelling of a page redirects permanently to the canonical address, and anything unknown answers 404.
// Same rules as src/proxy.ts and lib/routes.ts; the expected addresses come from routePath().
import { LOCALES, ROUTE_KEYS, routePath, type Locale, type RouteKey } from "../helpers/site";
import { DEFAULT_LOCALE, LOCALE_META } from "../../src/lib/i18n/config";
import { ROUTES } from "../../src/lib/routes";
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
        expect(htmlLang(await res.text())).toBe(LOCALE_META[locale].htmlLang);
      });
    }
  }

  test("the root is Czech whatever the browser asks for; English only under /en", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" } });
    const res = await ctx.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(htmlLang(await res.text())).toBe(LOCALE_META[DEFAULT_LOCALE].htmlLang);
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

// Every unknown address is a miss of the router (there is no catch-all route), so it gets the static global 404 page
// (src/app/global-not-found.tsx): status 404 and complete server HTML, never a streamed or client-rendered soft 404.
// The same page serves every language; a script picks the one of the address before paint (checked in navigation.spec).
test.describe("unknown addresses answer 404 with the styled page @desktop", () => {
  const unknown = [
    "/neexistuje",
    "/en/does-not-exist",
    "/xx/pudorys", // an unknown language prefix
    "/en/en",
    `${routePath("cs", "plan")}/extra`, // a known page with something appended
    `${routePath("en", "budget")}/extra/more`,
    "/en/index.html", // looks like a file: the proxy does not see it, the router does
    "/cs/x.y",
    `${routePath("cs", "plan")}.html`,
    "/index.html", // a file name in the place of the language
    "/models/nothing.glb", // a missing file in a public folder
    "/media/nothing.jpg",
  ];
  for (const path of unknown) {
    test(`${path}`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), "status").toBe(404);
      expect(res.headers()["content-type"]).toContain("text/html");
      const html = await res.text();
      // the styled page that search engines are told to skip, in the default language until the script runs
      expect(htmlLang(html)).toBe(LOCALE_META[DEFAULT_LOCALE].htmlLang);
      expect(html).toContain('class="nav');
      expect(html).toContain('<meta name="robots" content="noindex"');
      // complete server HTML: the heading is inside <main>, nothing waits for a streamed boundary or for the client
      expect(html).toMatch(/<main\b[^>]*>[\s\S]*?<h1\b[\s\S]*?<\/main>/);
      expect(html).not.toContain('<template id="B:');
      expect(html).not.toContain('id="__next_error__"');
    });
  }
});
