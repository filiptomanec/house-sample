// Floor plan: the rooms of the drawing and the table are the rooms of the model, selecting a room (pointer, keyboard, table) changes
// the info panel, and the numbers shown are the model's own. Expected values come from the model, not from constants.
import { getFormatter } from "../../src/lib/i18n/format";
import { derived } from "../../src/lib/model/instance";
import { pick } from "../../src/lib/model/text";
import { parseNum } from "../../src/lib/i18n/format";
import { LOCALES, open, routePath, type Locale } from "../helpers/site";
import { expect, test, type Page } from "../helpers/test";

const room = (id: string) => derived.rooms.find((r) => r.id === id)!;

for (const locale of LOCALES) {
  test.describe(`floor plan (${locale})`, () => {
    const path = routePath(locale as Locale, "plan");
    const f = getFormatter(locale as Locale);

    test("the drawing and the table hold every room of the model, and the total adds up", async ({ page }) => {
      await open(page, path);
      await expect(page.locator("svg.plan-svg [data-room]")).toHaveCount(derived.rooms.length);
      for (const r of derived.rooms) await expect(page.locator(`svg.plan-svg [data-room="${r.id}"]`)).toHaveCount(1);
      await expect(page.locator("table.room-table tbody tr")).toHaveCount(derived.rooms.length);
      const total = derived.rooms.reduce((sum, r) => sum + r.area, 0);
      await expect(page.locator("table.room-table tfoot td.n").first()).toHaveText(f.num(total, 1));
    });

    test("the living room starts selected and the panel shows its facts from the model", async ({ page }) => {
      await open(page, path);
      const initial = derived.rooms.find((r) => r.role === "main-living") ?? derived.rooms[0];
      await expect(page.locator(`svg.plan-svg [data-room="${initial.id}"]`)).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("aside.pl-info h2")).toHaveText(pick(initial.name, locale as Locale));
      await expect(page.locator("aside.pl-info")).toContainText(f.area(initial.area, 2));
    });

    test("clicking another room in the drawing changes the panel", async ({ page }) => {
      await open(page, path);
      const initial = derived.rooms.find((r) => r.role === "main-living") ?? derived.rooms[0];
      // the room with the largest clear circle around its label point: a safe place to click, whatever its shape
      const target = [...derived.rooms].filter((r) => r.id !== initial.id).sort((a, b) => b.label.r - a.label.r)[0];
      const before = await page.locator("aside.pl-info").innerText();
      const at = await screenPoint(page, target.label.x, target.label.y);
      await page.mouse.click(at.x, at.y);
      await expect(page.locator(`svg.plan-svg [data-room="${target.id}"]`)).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("aside.pl-info h2")).toHaveText(pick(target.name, locale as Locale));
      await expect(page.locator("aside.pl-info")).toContainText(f.area(target.area, 2));
      expect(await page.locator("aside.pl-info").innerText()).not.toBe(before);
    });

    test("a row of the table selects its room", async ({ page }) => {
      await open(page, path);
      const initial = derived.rooms.find((r) => r.role === "main-living") ?? derived.rooms[0];
      const target = derived.rooms.find((r) => r.id !== initial.id)!;
      await page.locator("table.room-table .row-btn", { hasText: pick(target.name, locale as Locale) }).first().click();
      await expect(page.locator(`svg.plan-svg [data-room="${target.id}"]`)).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("aside.pl-info h2")).toHaveText(pick(target.name, locale as Locale));
      await expect(page.locator("table.room-table tr[aria-current=true]")).toHaveCount(1);
    });

    test("arrow keys move the selection from room to room @desktop", async ({ page }) => {
      await open(page, path);
      const initial = derived.rooms.find((r) => r.role === "main-living") ?? derived.rooms[0];
      const selected = page.locator('svg.plan-svg [data-room][aria-checked="true"]');
      await page.locator(`svg.plan-svg [data-room="${initial.id}"]`).focus();
      const visited = new Set<string>([initial.id]);
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
        await page.keyboard.press(key);
        const id = await selected.getAttribute("data-room");
        visited.add(id!);
        await expect(page.locator("aside.pl-info h2")).toHaveText(pick(room(id!).name, locale as Locale));
      }
      expect(visited.size, "the arrow keys reach other rooms").toBeGreaterThan(1);
    });
  });
}

test("measuring: two points give their distance", async ({ page }) => {
  await open(page, routePath("cs", "plan"));
  const buttons = page.locator(".pl-bar .seg button");
  await expect(buttons).toHaveCount(3);
  await buttons.nth(1).click(); // measure
  await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg.plan-svg")).toHaveAttribute("data-mode", "measure");
  // the label points of the two rooms that lie furthest apart
  let best: [typeof derived.rooms[number], typeof derived.rooms[number], number] | null = null;
  for (const a of derived.rooms) for (const b of derived.rooms) {
    const d = Math.hypot(a.label.x - b.label.x, a.label.y - b.label.y);
    if (!best || d > best[2]) best = [a, b, d];
  }
  const [a, b, distance] = best!;
  for (const r of [a, b]) {
    const at = await screenPoint(page, r.label.x, r.label.y);
    await page.mouse.click(at.x, at.y);
  }
  // the points snap to a grid of a few centimetres on both ends, so the result is the distance within a small tolerance
  const shown = await page.locator("aside.pl-info .stat .v").innerText();
  const value = parseNum(/[\d\s\u00a0.,]+/.exec(shown)?.[0] ?? "", "cs");
  expect(value, `distance shown: ${shown}`).not.toBeNull();
  expect(Math.abs(value! - distance)).toBeLessThan(0.15);
});

/** Screen position of a point given in house coordinates (metres, y up); the plan is scrolled so that the point is in the middle of the window. */
async function screenPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const locate = () =>
    page.locator("svg.plan-svg").evaluate((svg: SVGSVGElement, p: { x: number; y: number }) => {
      const pt = new DOMPoint(p.x, -p.y).matrixTransform(svg.getScreenCTM()!);
      return { x: pt.x, y: pt.y, height: window.innerHeight };
    }, { x, y });
  const first = await locate();
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "instant" }), first.y - first.height / 2);
  await page.waitForTimeout(100);
  const { x: sx, y: sy } = await locate();
  return { x: sx, y: sy };
}
