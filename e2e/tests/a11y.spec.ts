// Accessibility basics without an external checker: landmarks, headings, unique ids, names of controls (read from the browser's own
// accessibility tree), the skip link and visible keyboard focus. Structure does not depend on the device, so these run on the desktop.
import { knownIssue, noteKnown } from "../helpers/known-issues";
import { PAGES, open } from "../helpers/site";
import { expect, test } from "../helpers/test";

/** Roles that must always have a name; the aria snapshot prints a name in quotes right after the role. */
const NAMED_ROLES = ["button", "link", "textbox", "slider", "checkbox", "switch", "radio", "combobox", "spinbutton", "searchbox", "tab", "img"];
const NAMELESS = new RegExp(`^\\s*- (${NAMED_ROLES.join("|")})(?: \\[[^\\]]*\\])*(?::|$)`);

for (const p of PAGES) {
  test.describe(`a11y: ${p.name} @desktop`, () => {
    test("landmarks, headings, unique ids, images and form controls", async ({ page }, testInfo) => {
      await open(page, p.path);

      // landmarks: one banner, one main, one contentinfo, and every <nav> tells which navigation it is
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      const navs = page.locator("nav");
      for (let i = 0; i < (await navs.count()); i++) {
        const nav = navs.nth(i);
        const named = (await nav.getAttribute("aria-label")) || (await nav.getAttribute("aria-labelledby"));
        expect(named, `<nav> number ${i + 1} has no name`).toBeTruthy();
      }

      // headings: one h1, never a level skipped on the way down (h2 -> h4), none empty
      const levels = await page.$$eval("h1,h2,h3,h4,h5,h6", (hs) => hs.map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim() })));
      expect(levels.filter((h) => h.level === 1)).toHaveLength(1);
      expect(levels.filter((h) => !h.text), "empty headings").toEqual([]);
      const skips = levels.flatMap((h, i) => (i > 0 && h.level > levels[i - 1].level + 1 ? [`h${levels[i - 1].level} -> h${h.level} "${h.text.slice(0, 30)}"`] : []));
      const known = knownIssue("heading-skip", { project: testInfo.project.name, locale: p.locale, key: p.key });
      if (known) noteKnown(testInfo, known, skips.length > 0);
      else expect(skips, "skipped heading levels").toEqual([]);

      // ids are unique, and everything that points at an id finds it
      const ids = await page.$$eval("[id]", (els) => els.map((e) => e.id));
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), "duplicate ids").toEqual([]);
      const dangling = await page.evaluate(() => {
        const out: string[] = [];
        for (const attr of ["aria-labelledby", "aria-describedby"]) {
          document.querySelectorAll(`[${attr}]`).forEach((el) => {
            for (const id of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) if (!document.getElementById(id)) out.push(`${attr}=${id} on <${el.tagName.toLowerCase()}>`);
          });
        }
        return out;
      });
      expect(dangling, "aria references to missing ids").toEqual([]);

      // images have an alt attribute (empty for decoration); form fields have a label
      expect(await page.locator("img:not([alt])").count(), "images without alt").toBe(0);
      const unlabeled = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea").forEach((el) => {
          const named = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el.labels && el.labels.length > 0) || el.title;
          if (!named) out.push(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""}#${el.id}`);
        });
        return out;
      });
      expect(unlabeled, "form fields without a label").toEqual([]);
    });

    test("every control in the accessibility tree has a name", async ({ page }) => {
      await open(page, p.path);
      const snapshot = await page.locator("body").ariaSnapshot();
      const nameless = snapshot.split("\n").filter((line) => NAMELESS.test(line));
      expect(nameless, "controls and images without an accessible name").toEqual([]);
    });
  });
}

test.describe("skip link and keyboard focus @desktop", () => {
  for (const p of [PAGES.find((x) => x.locale === "cs" && x.key === "home")!, PAGES.find((x) => x.locale === "en" && x.key === "budget")!]) {
    test(`the first Tab stop of ${p.name} is the skip link, it shows and works`, async ({ page }) => {
      await open(page, p.path);
      await page.keyboard.press("Tab");
      const skip = page.locator("a.skip-link");
      await expect(skip).toBeFocused();
      await expect(skip).toHaveAttribute("href", "#content");
      const box = (await skip.boundingBox())!;
      expect(box.y, "the skip link is on screen when focused").toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThan(200);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#content$/);
      expect(await page.evaluate(() => document.activeElement?.id), "focus moves to the main content").toBe("content");
    });
  }

  for (const p of [PAGES.find((x) => x.locale === "cs" && x.key === "home")!, PAGES.find((x) => x.locale === "en" && x.key === "budget")!, PAGES.find((x) => x.locale === "cs" && x.key === "energy")!]) {
    test(`keyboard focus is visible on the first controls of ${p.name}`, async ({ page }) => {
      await open(page, p.path);
      const hidden: string[] = [];
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        const visible = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor !== "rgba(0, 0, 0, 0)";
          const shadow = cs.boxShadow !== "none";
          // custom controls (a switch, a range input) draw the focus on a sibling or a pseudo element; accept a focus-visible rule on the element or its label
          const label = el.closest("label");
          const labelRing = label ? getComputedStyle(label).outlineStyle !== "none" : false;
          return { ok: ring || shadow || labelRing || el.matches(":focus-visible"), name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).slice(0, 30)}`, focusVisible: el.matches(":focus-visible") };
        });
        if (visible && !visible.ok) hidden.push(visible.name);
      }
      expect(hidden, "focused elements with no visible focus indicator").toEqual([]);
    });
  }
});
