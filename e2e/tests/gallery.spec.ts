// Gallery: every still of the manifest is a tile with its alt text, the filters narrow the grid, and the lightbox opens, pages
// with the arrow keys, closes with Escape and gives the focus back to the tile it came from.
import { media } from "../../src/lib/data/media";
import { LOCALES, open, routePath, type Locale } from "../helpers/site";
import { expect, test } from "../helpers/test";

// the tests below run without motion: the lightbox then swaps at once instead of morphing from the tile (see the last test)
test.use({ reducedMotion: "reduce" });

for (const locale of LOCALES) {
  test.describe(`gallery (${locale})`, () => {
    const path = routePath(locale as Locale, "gallery");

    // the "before" half of the slider (gallery: false) is not a gallery picture
    const shown = media.stills.filter((s) => s.gallery !== false);

    test("every gallery still of the manifest is a tile with its alt text", async ({ page }) => {
      await open(page, path);
      const tiles = page.locator(".gal-item");
      await expect(tiles).toHaveCount(shown.length);
      const alts = await page.locator(".gal-item img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).alt));
      expect(alts.sort()).toEqual(shown.map((s) => s.alt[locale as Locale]).sort());
      // the images that are in view have loaded
      await tiles.first().scrollIntoViewIfNeeded();
      await expect.poll(() => page.locator(".gal-item img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    });

    test("a filter narrows the grid; filters exist only for a category of at least 3 (and fewer than all) pictures", async ({ page }) => {
      await open(page, path);
      const buttons = page.locator(".seg button").filter({ has: page.locator(".gal-n") });
      const count = await buttons.count();
      if (count === 0) return; // nothing worth choosing between: no filter control (see MIN_FILTER_ITEMS in gallery/view.ts)
      expect(count, '"all" and at least one real choice').toBeGreaterThan(1);
      const counts: number[] = [];
      for (let i = 0; i < count; i++) counts.push(Number(await buttons.nth(i).locator(".gal-n").innerText()));
      expect(counts[0], "the first filter is \"all\"").toBe(shown.length);
      for (let i = 1; i < count; i++) {
        expect(counts[i]).toBeGreaterThanOrEqual(3);
        expect(counts[i]).toBeLessThan(shown.length);
        await buttons.nth(i).click();
        await expect(buttons.nth(i)).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(".gal-item")).toHaveCount(counts[i]);
      }
      await buttons.nth(0).click(); // "all" again
      await expect(page.locator(".gal-item")).toHaveCount(shown.length);
    });

    test("the lightbox opens, pages with the arrow keys and closes with Escape", async ({ page }) => {
      await open(page, path);
      const tiles = page.locator(".gal-item");
      const first = tiles.first();
      await first.scrollIntoViewIfNeeded();
      await first.click();
      const box = page.getByRole("dialog");
      await expect(box).toBeVisible();
      await expect(box).toHaveAttribute("aria-modal", "true");
      await expect(box.locator("button.lb-close")).toBeFocused();
      await expect(box.locator("img")).toHaveAttribute("alt", (await first.locator("img").getAttribute("alt"))!);
      const counter = box.locator(".lb-count");
      const one = await counter.innerText();
      await page.keyboard.press("ArrowRight");
      await expect(counter).not.toHaveText(one);
      await page.keyboard.press("ArrowLeft");
      await expect(counter).toHaveText(one);
      // the page behind is not reachable while the box is open
      expect(await page.evaluate(() => (document.querySelector("main") as HTMLElement).inert), "the page behind is inert").toBe(true);
      await page.keyboard.press("Escape");
      await expect(box).toHaveCount(0);
      await expect(first).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe("hidden");
    });

    test("the close button closes the lightbox", async ({ page }) => {
      await open(page, path);
      await page.locator(".gal-item").first().scrollIntoViewIfNeeded();
      await page.locator(".gal-item").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.locator("button.lb-close").click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  });
}

// With motion, opening and closing the lightbox quickly starts a second view transition before the first has finished; the
// promises of the skipped one reject, and gallery/morph.ts must catch them (it did not once: "Transition was skipped" as an
// uncaught error in Chromium).
test.describe("lightbox with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("opening and closing at once leaves no uncaught error", async ({ page }) => {
    await open(page, routePath("cs", "gallery"));
    const tile = page.locator(".gal-item").first();
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape"); // no pause: the opening morph is still running
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForTimeout(800); // a skipped transition rejects its promises after the fact; the guard fails the test on any of them
  });
});
