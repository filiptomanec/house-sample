// Sun page, the part that does not need WebGL: the day presets and the date field change the facts about the sun, and the numbers
// are the ones the calc module gives for the house's place. (The 3D scene of this page is in scene.spec.ts.)
import assumptions from "../../model/assumptions.json";
import { placeOf, sunTimes } from "../../src/lib/calc/sun";
import { getFormatter } from "../../src/lib/i18n/format";
import { house } from "../../src/lib/model/instance";
import { LOCALES, open, routePath, type Locale } from "../helpers/site";
import { expect, test, type Page } from "../helpers/test";

const YEAR = assumptions.climate.referenceYear;
const place = placeOf(house);
const factValue = (page: Page, term: RegExp) => page.locator(".sun-facts dt").filter({ hasText: term }).locator("xpath=following-sibling::dd[1]");

for (const locale of LOCALES) {
  test.describe(`sun (${locale})`, () => {
    const path = routePath(locale as Locale, "sun");
    const f = getFormatter(locale as Locale);

    test("each day preset shows the day length the calc module gives for that date", async ({ page }) => {
      await open(page, path);
      const presets = page.locator(".sun-day-pick .seg button");
      await expect(presets).toHaveCount(4);
      const lengths = new Set<string>();
      for (let i = 0; i < 4; i++) {
        await presets.nth(i).click();
        await expect(presets.nth(i)).toHaveAttribute("aria-pressed", "true");
        const iso = await page.locator("input.sun-date").inputValue();
        const [year, month, day] = iso.split("-").map(Number);
        expect(year).toBe(YEAR);
        const expected = f.duration(sunTimes(place, { year, month: month - 1, day }).dayLength);
        const dayLength = factValue(page, /./).last(); // the last entry of the list is the length of the day
        await expect(dayLength).toHaveText(expected);
        lengths.add(expected);
      }
      expect(lengths.size, "the four reference days differ").toBeGreaterThan(1);
    });

    test("typing a date and moving the time update the facts", async ({ page }) => {
      await open(page, path);
      const date = page.locator("input.sun-date");
      await date.fill(`${YEAR}-12-21`);
      const expected = f.duration(sunTimes(place, { year: YEAR, month: 11, day: 21 }).dayLength);
      await expect(page.locator(".sun-facts dd").last()).toHaveText(expected);
      // the time slider: a later hour, a different position of the sun
      const altitude = page.locator(".sun-facts dd").nth(1);
      const noon = await altitude.innerText();
      const time = page.locator(".sun-pick input[type=range]");
      await time.focus();
      await page.keyboard.press("Home");
      await expect(altitude).not.toHaveText(noon);
    });

    test("play runs the day and stop keeps the time", async ({ page }) => {
      await open(page, path);
      const play = page.locator("button.sun-play");
      const label = await play.innerText();
      await play.click();
      await expect(play).not.toHaveText(label);
      await page.waitForTimeout(600);
      await play.click();
      await expect(play).toHaveText(label);
    });
  });
}
