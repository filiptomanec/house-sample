// Budget: the headline numbers agree, an optional group changes the total and puts it back, the reserve slider and an edited
// quantity move the total, reset restores the book's own choice, and the CSV holds what the page shows.
import fs from "node:fs";
import { getT } from "../../src/lib/i18n/server";
import { open, routePath } from "../helpers/site";
import { expect, test, type Locator, type Page } from "../helpers/test";

const digits = (text: string) => Number(text.replace(/\D/g, ""));
/** The cells of one CSV line (a cell with the separator in it is in double quotes, a quote inside is doubled). */
function csvCells(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { cells.push(cell); cell = ""; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}
const sideTotal = (page: Page) => page.locator("aside.budget-side dd.sum output");
const summaryTotal = (page: Page) => page.locator(".budget-stats .stat.signal .v");
const totalCzk = async (page: Page) => digits(await sideTotal(page).innerText());
const optionalGroup = (page: Page) => page.locator("section.budget-group").filter({ has: page.locator("input[role=switch]") }).first();

/** Groups are `details.bg-details`; on phones only the first one is open, so open the one holding the control first. */
const reveal = async (group: Locator) => {
  await group.locator("details.bg-details").first().evaluate((d) => { (d as HTMLDetailsElement).open = true; });
};

for (const locale of ["cs", "en"] as const) {
  test.describe(`budget (${locale})`, () => {
    const path = routePath(locale, "budget");
    const t = getT(locale);

    test("the headline total and the total of the side panel agree", async ({ page }) => {
      await open(page, path);
      const crowns = await totalCzk(page);
      expect(crowns).toBeGreaterThan(1_000_000);
      const million = Number(/\d+[,.]\d+/.exec(await summaryTotal(page).innerText())![0].replace(",", "."));
      // the headline is an estimate to three significant digits, so the tolerance is half a unit of the last digit shown
      const tolerance = 0.5 * 10 ** (Math.floor(Math.log10(crowns / 1e6)) - 2) + 1e-9;
      expect(Math.abs(crowns / 1e6 - million), "the million shown is the total rounded to three significant digits").toBeLessThanOrEqual(tolerance);
      await expect(page.locator("aside.budget-side .btn.ghost")).toBeDisabled(); // nothing changed yet
    });

    test("an optional group changes the total, and switching it back restores it", async ({ page }) => {
      await open(page, path);
      const start = await totalCzk(page);
      const startHeadline = await summaryTotal(page).innerText();
      const group = optionalGroup(page);
      await reveal(group);
      const toggle = group.locator("input[role=switch]");
      const wasOn = await toggle.isChecked();
      await toggle.setChecked(!wasOn);
      await expect.poll(() => totalCzk(page)).not.toBe(start);
      const changed = await totalCzk(page);
      expect(wasOn ? changed < start : changed > start, "switching a group off lowers the total, on raises it").toBe(true);
      await expect(summaryTotal(page)).not.toHaveText(startHeadline); // the headline number moved too
      await expect(group.locator("table")).toHaveCount(wasOn ? 0 : 1); // an off group shows no lines
      await expect(page.locator("aside.budget-side .btn.ghost")).toBeEnabled();
      await toggle.setChecked(wasOn);
      await expect.poll(() => totalCzk(page)).toBe(start);
      await expect(page.locator("aside.budget-side .btn.ghost")).toBeDisabled(); // back at the book's own choice
    });

    test("the reserve slider moves the total and reset brings everything back", async ({ page }) => {
      await open(page, path);
      const start = await totalCzk(page);
      const slider = page.locator("aside.budget-side input[type=range]");
      await slider.focus();
      await page.keyboard.press("End");
      await expect.poll(() => totalCzk(page)).toBeGreaterThan(start);
      await page.locator("aside.budget-side .btn.ghost").click();
      await expect.poll(() => totalCzk(page)).toBe(start);
    });

    test("an edited quantity changes the total and can be reset", async ({ page }) => {
      await open(page, path);
      const start = await totalCzk(page);
      const cell = page.locator("section.budget-group table input.cell-in").first();
      const original = await cell.inputValue();
      await cell.fill(String(Math.round(digits(original) * 2 + 10)));
      await cell.press("Enter");
      await expect.poll(() => totalCzk(page)).toBeGreaterThan(start);
      await expect(cell).toHaveAttribute("data-edited", "");
      await page.locator("section.budget-group table .cell-reset").first().click();
      await expect.poll(() => totalCzk(page)).toBe(start);
      await expect(cell).toHaveValue(original);
    });

    test("the CSV download holds the groups that are on and the total on the page", async ({ page }) => {
      await open(page, path);
      // switch an optional group off, so that the file must leave it out
      const group = optionalGroup(page);
      await reveal(group);
      const toggle = group.locator("input[role=switch]");
      const wasOn = await toggle.isChecked();
      if (wasOn) await toggle.setChecked(false);
      const groupName = (await group.locator("h3").innerText()).trim();
      const shown = await totalCzk(page);
      const rows = await page.locator("table.budget-table tbody tr").count();

      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: t("budget.side.csv") }).click()]);
      expect(download.suggestedFilename()).toBe(t("budget.csv.file"));
      const csv = fs.readFileSync((await download.path())!, "utf8");
      expect(csv.charCodeAt(0), "byte order mark for Excel").toBe(0xfeff);
      const lines = csv.slice(1).split("\r\n").filter((l) => l.length > 0);
      const header = lines[0];
      expect(header).toContain(t("budget.csv.item"));
      expect(header).toContain(t("budget.csv.amount"));
      expect(csv, "the group that is off is not in the file").not.toContain(groupName);
      // one line per table row on the page, then net / reserve / VAT / total
      expect(lines.length).toBe(1 + rows + 4);
      const last = lines.at(-1)!;
      expect(last).toContain(t("budget.csv.total"));
      expect(digits(csvCells(last, locale === "cs" ? ";" : ",").at(-1)!), "the total in the file is the total on the page").toBe(shown);
    });
  });
}
