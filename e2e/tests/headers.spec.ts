// Response headers and the machine-readable files, at the HTTP level (no browser). The rules live in next.config.ts:
// the USDZ file must carry the AR Quick Look media type, versioned model files and media are immutable, pages revalidate.
import { LOCALES, ROUTE_KEYS, routePath } from "../helpers/site";
import { SITE, absoluteUrl } from "../../src/lib/site-config";
import { media } from "../../src/lib/data/media";
import { expect, test } from "../helpers/test";


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

  test("sitemap.xml lists every page in both languages with its translations", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    for (const key of ROUTE_KEYS) {
      for (const locale of LOCALES) {
        expect(xml, `${locale} ${key}`).toContain(`<loc>${absoluteUrl(routePath(locale, key))}</loc>`);
      }
    }
    expect(xml).toContain('hreflang="en"');
    expect(xml).toContain('hreflang="cs"');
  });

  test("the web app manifest and the icons it names exist", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { name?: string; start_url?: string; icons?: { src: string; sizes?: string }[] };
    expect(manifest.name?.length).toBeGreaterThan(0);
    expect(manifest.icons?.length).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    for (const path of ["/icon.svg", "/apple-icon.png", "/opengraph-image.jpg", "/twitter-image.jpg"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});
