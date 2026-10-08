// Phone behaviour (the three phone projects): touch targets of at least the --touch token (44 px), text fields that do not make
// iOS zoom in, a menu whose entries are easy to hit, and pages that stay inside the screen after they have been scrolled through.
import { PAGES, hasHorizontalScroll, navigation, open } from "../helpers/site";
import { expect, test } from "../helpers/test";

/** Controls that must be at least this big on a touch screen (inline links inside running text are exempt, as in WCAG 2.2). */
const TOUCH = 44;
/** A pixel or two of rounding must not fail a test. */
const SLACK = 1;
const CONTROLS = "button, [role=button], input:not([type=hidden]), select, textarea, summary, .btn, .chip, .seg button, nav a, .lang a, .icon-btn";

const cs = PAGES.filter((p) => p.locale === "cs");

test.describe("touch targets @mobile", () => {
  for (const p of cs) {
    test(`controls on ${p.name} are at least ${TOUCH} px high`, async ({ page }) => {
      await open(page, p.path);
      const small = await page.evaluate(
        ({ selector, min, slack }) => {
          const out: string[] = [];
          const seen = new Set<Element>();
          document.querySelectorAll(selector).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            const e = el as HTMLElement;
            const style = getComputedStyle(e);
            if (style.visibility === "hidden" || style.display === "none" || e.closest("[inert], [hidden], .sr-only")) return;
            // a switch or a checkbox is a small input inside a big label: the label is the target
            let box = e.getBoundingClientRect();
            if (e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio") && e.labels?.[0]) box = e.labels[0].getBoundingClientRect();
            if (box.width < 2 || box.height < 2) return; // visually hidden helpers
            // the focus-trapping stage and scrollers: a canvas group is not a button
            if (e.closest(".stage") && !e.matches("button")) return;
            if (box.height < min - slack) out.push(`${e.tagName.toLowerCase()}.${String(e.className).replace(/\s+/g, ".").slice(0, 30)} "${(e.textContent ?? "").trim().slice(0, 24)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
          });
          return out;
        },
        { selector: CONTROLS, min: TOUCH, slack: SLACK },
      );
      expect(small, "controls smaller than the touch target").toEqual([]);
    });
  }

  test("the entries of the open menu are touch-sized", async ({ page }) => {
    await open(page, "/");
    const menu = await navigation(page);
    const heights = await Promise.all((await menu.locator("a").all()).map(async (link) => (await link.boundingBox())!.height));
    // also on the 568 px high iPhone SE: the rows are 44 px and the menu fits without scrolling (docs/DESIGN.md, Nav)
    expect(Math.min(...heights), "the smallest menu entry").toBeGreaterThanOrEqual(TOUCH - SLACK);
    const toggle = (await page.locator(".nav-toggle").boundingBox())!;
    expect(toggle.height).toBeGreaterThanOrEqual(TOUCH - SLACK);
  });
});

test.describe("text fields do not trigger the iOS zoom @mobile", () => {
  // Safari zooms into any text field with a font smaller than 16 px when it gets the focus
  for (const key of ["energy", "budget", "sun"] as const) {
    test(`fields on ${key} use at least 16 px`, async ({ page }) => {
      await open(page, PAGES.find((p) => p.locale === "cs" && p.key === key)!.path);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=radio]), select, textarea").forEach((el) => {
          if (el.getClientRects().length === 0) return;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 16) out.push(`${el.tagName.toLowerCase()}[${el.type}] ${size}px`);
        });
        return out;
      });
      expect(small, "fields with a font smaller than 16 px").toEqual([]);
    });
  }
});

test.describe("the page stays inside the screen @mobile", () => {
  for (const p of PAGES.filter((x) => ["home", "plan", "plot", "energy", "budget", "gallery"].includes(x.key))) {
    test(`${p.name} does not scroll sideways after scrolling to the end`, async ({ page }) => {
      await open(page, p.path);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= height; y += 700) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(40); // lazy images and reveal-on-scroll blocks
      }
      expect(await hasHorizontalScroll(page), "the page scrolls sideways").toBe(false);
    });
  }

  test("the open menu does not scroll sideways, and the page does not move behind it", async ({ page }) => {
    await open(page, "/");
    await navigation(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
  });
});
