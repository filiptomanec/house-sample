// 3D model page, the part that needs no WebGL: the layer switches (and that the browser remembers them), the camera presets and the
// export section: the STL download is byte for byte what the print module builds from the model, with an ASCII header that names
// nothing but the project; the GLB link works. (The scene itself is in scene.spec.ts.)
import fs from "node:fs";
import { PRINT_SCALES, STL_HEADER_PREFIX, buildPrintMesh, toBinaryStl, type PrintGround } from "../../src/lib/calc/printModel";
import { getFormatter } from "../../src/lib/i18n/format";
import { getT } from "../../src/lib/i18n/server";
import { derived, house } from "../../src/lib/model/instance";
import { createSite } from "../../src/lib/model/site";
import siteJson from "../../model/site.json";
import { open, routePath } from "../helpers/site";
import { expect, test, type Page } from "../helpers/test";

const site = createSite(siteJson, house.location.houseAxisBearingDeg);

/** The STL the page must offer for these options: the library's own output for the scale named in the file name. */
const oracle = (ground: PrintGround, outdoor: boolean, scale: number) => Buffer.from(toBinaryStl(buildPrintMesh(derived, site, { ground, outdoor }), scale));

async function saveStl(page: Page, label: string) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()]);
  const name = download.suggestedFilename();
  const match = /^house-sample-1-(\d+)\.stl$/.exec(name);
  expect(match, `file name ${name}`).not.toBeNull();
  return { name, scale: Number(match![1]), bytes: fs.readFileSync((await download.path())!) };
}

for (const locale of ["cs", "en"] as const) {
  test.describe(`model page (${locale})`, () => {
    const path = routePath(locale, "model");
    const t = getT(locale);
    const f = getFormatter(locale);

    test("the STL download is the model, with a header that holds no personal data", async ({ page }) => {
      await open(page, path);
      const { scale, bytes } = await saveStl(page, t("model.export.print.download"));
      expect(PRINT_SCALES as readonly number[]).toContain(scale);
      // 80-byte ASCII header, uint32 triangle count, 50 bytes per triangle
      const header = bytes.subarray(0, 80).toString("latin1");
      expect(header.startsWith(STL_HEADER_PREFIX)).toBe(true);
      expect(header, "printable ASCII only").toMatch(/^[\x20-\x7e]{80}$/);
      expect(header.trim(), "the header names the project and the scale, nothing else").toBe(`${STL_HEADER_PREFIX} 1:${scale}`);
      const triangles = bytes.readUInt32LE(80);
      expect(bytes.length).toBe(84 + 50 * triangles);
      // the page says the same number
      await expect(page.locator("#tisk dl.kv dd").nth(1)).toHaveText(f.int(triangles));
      // and the bytes are exactly what the print module builds from the model
      expect(bytes.equals(oracle("plate", true, scale))).toBe(true);
    });

    test("the base and the outdoor switch change the file", async ({ page }) => {
      await open(page, path);
      const base = page.locator("#tisk .seg").nth(1);
      await base.getByRole("button", { name: t("model.export.print.groundNone") }).click();
      await page.locator("#tisk input[role=switch]").setChecked(false);
      const { scale, bytes } = await saveStl(page, t("model.export.print.download"));
      expect(bytes.equals(oracle("none", false, scale))).toBe(true);
      expect(bytes.readUInt32LE(80), "fewer triangles than with a plate and outdoor areas").toBeLessThan(oracle("plate", true, scale).readUInt32LE(80));
    });

    test("the GLB download link points to a file that exists", async ({ page, request }) => {
      await open(page, path);
      const link = page.locator('a[download="house-sample.glb"]');
      await expect(link).toHaveAttribute("href", /^\/models\/house-lite\.glb\?v=[0-9a-f]+$/);
      const res = await request.get((await link.getAttribute("href"))!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("model/gltf-binary");
    });

    test("AR: where the browser supports it the link opens the USDZ, elsewhere the page says it cannot", async ({ page, request }) => {
      await open(page, path);
      const ar = page.locator("a[rel=ar]");
      if (await ar.count()) {
        const res = await request.get((await ar.getAttribute("href"))!);
        expect(res.headers()["content-type"]).toBe("model/vnd.usdz+zip");
      } else {
        await expect(page.getByText(t("model.export.ar.unavailable"))).toBeVisible();
      }
    });

    test("the layer switches work and are written to the browser's storage", async ({ page }) => {
      await open(page, path);
      const roof = page.getByRole("switch", { name: t("model.layers.roof") });
      await expect(roof).toBeChecked();
      await roof.setChecked(false);
      await expect(roof).not.toBeChecked();
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("hs-model") ?? "null"));
      expect(stored?.data?.roof).toBe(false);
      await roof.setChecked(true);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("hs-model") ?? "null")?.data?.roof)).toBe(true);
    });

    test("the camera presets: one is lit and choosing another moves the light", async ({ page }) => {
      await open(page, path);
      const chips = page.locator(".model-views .chip");
      expect(await chips.count()).toBeGreaterThan(1);
      await expect(page.locator('.model-views .chip[aria-pressed="true"]')).toHaveCount(1);
      await chips.nth(1).click();
      await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('.model-views .chip[aria-pressed="true"]')).toHaveCount(1);
    });
  });
}
