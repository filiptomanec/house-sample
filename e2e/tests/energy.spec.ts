// Energy: the results are live. Moving a slider or typing a price changes the figures, reset brings the model's assumptions back,
// the month buttons change the day chart, and the PV size in the results is the model's.
import { getFormatter, parseNum } from "../../src/lib/i18n/format";
import { getT } from "../../src/lib/i18n/server";
import { derived } from "../../src/lib/model/instance";
import { open, routePath, type Locale } from "../helpers/site";
import { expect, test, type Page } from "../helpers/test";

/** The first number of a text in the language of the page: "12,4 MWh" and "12.4 MWh" -> 12.4, "528 102 Kč" and "528,102 CZK" -> 528102. */
const num = (text: string, locale: Locale) => parseNum(/-?\d[\d\s\u00a0.,]*\d|\d/.exec(text)![0], locale)!;
const figures = (page: Page) => page.locator(".energy-figures .stat .v");
const money = (page: Page) => page.locator(".energy-money .stat .v");
const texts = async (loc: ReturnType<Page["locator"]>) => (await loc.allInnerTexts()).map((s) => s.trim());

for (const locale of ["cs", "en"] as const) {
  test.describe(`energy (${locale})`, () => {
    const path = routePath(locale, "energy");
    const t = getT(locale);
    const f = getFormatter(locale);

    test("the results show four figures and the PV size of the model", async ({ page }) => {
      await open(page, path);
      await expect(figures(page)).toHaveCount(4);
      for (const text of await texts(figures(page))) expect(num(text, locale), text).toBeGreaterThan(0);
      await expect(page.locator(".energy-figures .stat.accent .k")).toContainText(f.unit(derived.pv.kwp, t("energy.units.kwp"), 2));
    });

    test("a warmer house needs more heat, more people need more electricity, reset restores both", async ({ page }) => {
      await open(page, path);
      const start = await texts(figures(page));
      const [, heat0, electricity0] = start.map((x) => num(x, locale));

      const temperature = page.getByLabel(t("energy.settings.indoorTemp"));
      await temperature.focus();
      await page.keyboard.press("End");
      await expect.poll(async () => num((await texts(figures(page)))[1], locale)).toBeGreaterThan(heat0);

      const persons = page.getByLabel(t("energy.settings.persons"));
      await persons.focus();
      await page.keyboard.press("End");
      await expect.poll(async () => num((await texts(figures(page)))[2], locale)).toBeGreaterThan(electricity0);

      await page.locator(".energy-reset").click();
      await expect.poll(() => texts(figures(page))).toEqual(start);
    });

    test("a typed price changes the money figures", async ({ page }) => {
      await open(page, path);
      const start = await texts(money(page));
      // on a phone only the first group is open
      const prices = page.locator("details.grp").nth(2);
      if (!(await prices.evaluate((d: HTMLDetailsElement) => d.open))) await prices.locator("summary").click();
      const price = page.getByLabel(t("energy.settings.pvPrice"));
      await price.fill(String(num(await price.inputValue(), locale) * 2 + 1000));
      await price.press("Enter");
      await expect.poll(() => texts(money(page))).not.toEqual(start);
      // the investment (third figure) went up
      expect(num((await texts(money(page)))[2], locale)).toBeGreaterThan(num(start[2], locale));
    });

    test("the month buttons choose the month of the day chart", async ({ page }) => {
      await open(page, path);
      const months = page.locator(".month-pick button");
      await expect(months).toHaveCount(12);
      const title = page.locator("#day-title");
      const before = await title.innerText();
      await months.nth(0).click();
      await expect(months.nth(0)).toHaveAttribute("aria-pressed", "true");
      const january = await title.innerText();
      await months.nth(6).click();
      await expect(months.nth(6)).toHaveAttribute("aria-pressed", "true");
      await expect(title).not.toHaveText(january);
      expect(new Set([before, january, await title.innerText()]).size, "the title names the month").toBeGreaterThan(1);
    });
  });
}
