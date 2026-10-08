// Response headers and the machine-readable files, at the HTTP level (no browser). The rules live in next.config.ts:
// security headers on every response, the USDZ file must carry the AR Quick Look media type, versioned model files and
// media are immutable, pages revalidate. Sitemap, robots and canonical links share one URL form on the canonical host.
import { LOCALES, ROUTE_KEYS, routePath } from "../helpers/site";
import { LOCALE_META } from "../../src/lib/i18n/config";
import { SITE, canonicalUrl } from "../../src/lib/site-config";
import { media } from "../../src/lib/data/media";
import { expect, test } from "../helpers/test";

test.describe("security headers @desktop", () => {
  // a page, the 404 page, a static file and a metadata route: the rule in next.config.ts covers every response
  for (const path of [routePath("cs", "home"), routePath("en", "plan"), "/neexistuje", "/robots.txt", "/icon.svg"]) {
    test(`${path} carries the security headers`, async ({ request }) => {
      const h = (await request.get(path, { maxRedirects: 0 })).headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      for (const feature of ["camera", "microphone", "geolocation"]) expect(h["permissions-policy"]).toContain(`${feature}=()`);
      const csp = (h["content-security-policy"] ?? "").split(";").map((d) => d.trim());
      // only the site itself and the owner's portfolio origins may show the site in an iframe
      expect(csp).toContain(["frame-ancestors", "'self'", ...SITE.embedOrigins].join(" "));
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(h["x-powered-by"]).toBeUndefined();
    });
  }
});


test.describe("headers @desktop", () => {
  test("house.usdz has the AR Quick Look media type and a short cache", async ({ request }) => {
    const res = await request.get("/models/house.usdz");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("model/vnd.usdz+zip");
    expect(res.headers()["cache-control"]).toBe("public, max-age=3600");
    expect((await res.body()).byteLength).toBeGreaterThan(1000);
  });

  test("GLB files are served as glTF binary and cached for good", async ({ request }) => {
    for (const file of ["house.glb", "house-lite.glb", "furniture-lite.glb"]) {
      const res = await request.get(`/models/${file}?v=abc`);
      expect(res.status(), file).toBe(200);
      expect(res.headers()["content-type"], file).toBe("model/gltf-binary");
      expect(res.headers()["cache-control"], file).toMatch(/max-age=31536000/);
      expect(res.headers()["cache-control"], file).toContain("immutable");
      expect(Buffer.from(await res.body()).subarray(0, 4).toString("latin1"), `${file} magic`).toBe("glTF");
    }
  });

  test("media files carry a content hash and are immutable; the draco decoder has a day", async ({ request }) => {
    const still = await request.fetch(`/${media.stills[0].file}`, { method: "HEAD" });
    expect(still.status()).toBe(200);
    expect(still.headers()["content-type"]).toBe("image/jpeg");
    expect(still.headers()["cache-control"]).toContain("immutable");
    expect(media.stills[0].file).toMatch(/\.[0-9a-f]{8,}\.jpg$/);
    const draco = await request.fetch("/draco/draco_decoder.wasm", { method: "HEAD" });
    expect(draco.status()).toBe(200);
    expect(draco.headers()["cache-control"]).toContain("max-age=86400");
  });

  test("pages revalidate; built assets are immutable", async ({ request }) => {
    const page = await request.get(routePath("cs", "plan"));
    expect(page.headers()["cache-control"] ?? "").not.toContain("immutable");
    expect(page.headers()["cache-control"] ?? "").not.toMatch(/(^|[^-])max-age=31536000/);
    const html = await page.text();
    const asset = /<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/.exec(html)?.[1];
    expect(asset, "a built script on the page").toBeTruthy();
    const res = await request.fetch(asset!, { method: "HEAD" });
    expect(res.headers()["cache-control"]).toContain("immutable");
  });
});

test.describe("machine-readable files @desktop", () => {
  test("robots.txt allows crawling and names the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/User-Agent: \*/i);
    expect(text).toContain(`Sitemap: ${SITE.url}/sitemap.xml`);
    expect(text).not.toMatch(/Disallow:\s*\/\s*$/m);
  });

  test("sitemap.xml lists every page in both languages with its translations and x-default", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(ROUTE_KEYS.flatMap((key) => LOCALES.map((locale) => canonicalUrl(routePath(locale, key)))).sort());
    for (const lang of [...LOCALES.map((l) => LOCALE_META[l].hreflang), "x-default"]) expect(xml).toContain(`hreflang="${lang}"`);
    // never the build clock: either no date or one content date for every entry
    const dates = new Set([...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]));
    expect(dates.size).toBeLessThanOrEqual(1);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  test("the sitemap and the pages use the same URL form (the home page included)", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const locs = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    for (const locale of LOCALES) {
      for (const key of ["home", "plan"] as const) {
        const html = await (await request.get(routePath(locale, key))).text();
        const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
        expect(locs.has(canonical ?? ""), `${locale} ${key}: canonical ${canonical} is a sitemap <loc>`).toBe(true);
      }
    }
  });

  test("canonical links, share images, robots and sitemap all name the canonical host", async ({ request }) => {
    const host = new URL(SITE.url).host;
    const html = await (await request.get(routePath("cs", "home"))).text();
    const urls = [
      /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1],
      /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1],
      /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1],
      /<meta name="twitter:image" content="([^"]+)"/.exec(html)?.[1],
    ];
    for (const u of urls) expect(u && new URL(u).host, u).toBe(host);
    expect(await (await request.get("/robots.txt")).text()).toContain(`Sitemap: ${SITE.url}/sitemap.xml`);
  });

  // Against a deployment (BASE_URL set, e.g. the deploy-check workflow): the canonical host must answer, or every share card
  // and search result points at a dead address. Skipped against a local server, whose canonical host is the production one.
  test("the canonical host answers: robots.txt and the share image", async ({ playwright, request }) => {
    test.skip(!process.env.BASE_URL, "needs a deployment (BASE_URL)");
    const html = await (await request.get(routePath("cs", "home"))).text();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(canonical, "canonical link").toBeTruthy();
    expect(image, "og:image").toBeTruthy();
    const ctx = await playwright.request.newContext();
    const robots = await ctx.get(new URL("/robots.txt", canonical).toString());
    expect(robots.status(), `${canonical} robots.txt`).toBe(200);
    const og = await ctx.get(image!);
    expect(og.status(), image).toBe(200);
    expect(og.headers()["content-type"]).toMatch(/^image\//);
    await ctx.dispose();
  });

  test("the web app manifest and the icons it names exist", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { name?: string; theme_color?: string; start_url?: string; icons?: { src: string; sizes?: string }[] };
    expect(manifest.name).toBe(SITE.house.name.cs); // the visible brand is the house name
    expect(manifest.theme_color).toBe(SITE.chrome.light); // a light site gets light browser chrome
    expect(manifest.icons?.length).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    for (const path of ["/icon.svg", "/apple-icon.png", "/opengraph-image.jpg", "/twitter-image.jpg"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});
