// What the browser remembers (localStorage) and what happens when it cannot: choices survive a reload, the colour scheme is applied
// before the first paint, and blocked, corrupt or outdated storage never produces an error (the guard of helpers/test.ts fails
// on any console error) but simply gives the defaults.
import { STORAGE_KEYS } from "../../src/lib/calc/storageKeys";
import { getT } from "../../src/lib/i18n/server";
import { open, routePath } from "../helpers/site";
import { expect, test, type Page } from "../helpers/test";

const t = getT("cs");
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);

test.describe("choices survive a reload", () => {
  test("model: the roof switch", async ({ page }) => {
    await open(page, routePath("cs", "model"));
    await page.getByRole("switch", { name: t("model.layers.roof") }).setChecked(false);
    await expect.poll(() => stored(page, STORAGE_KEYS.model)).not.toBeNull();
    await page.reload();
    await expect(page.getByRole("switch", { name: t("model.layers.roof") })).not.toBeChecked();
  });

  test("budget: a group, the reserve and an edited quantity", async ({ page }) => {
    await open(page, routePath("cs", "budget"));
    const total = page.locator("aside.budget-side dd.sum output");
    const toggle = page.locator("section.budget-group input[role=switch]").first();
    // groups are closed `details` on phones: open the one that holds the switch
    await toggle.evaluate((el) => { const d = el.closest("details"); if (d) d.open = true; });
    const was = await toggle.isChecked();
    await toggle.setChecked(!was);
    await page.locator("aside.budget-side input[type=range]").focus();
    await page.keyboard.press("End");
    await expect(page.locator("aside.budget-side .btn.ghost")).toBeEnabled();
    const changed = await total.innerText();
    await page.reload();
    await expect(page.locator("section.budget-group input[role=switch]").first()).toBeChecked({ checked: !was });
    await expect(total).toHaveText(changed);
    // reset clears the entry: nothing is stored for the book's own choice
    await page.locator("aside.budget-side .btn.ghost").click();
    await expect.poll(() => stored(page, STORAGE_KEYS.budget)).toBeNull();
  });

  test("energy: a slider", async ({ page }) => {
    await open(page, routePath("cs", "energy"));
    await page.locator("details.grp").nth(1).locator("summary").click();
    const slider = page.getByLabel(t("energy.settings.indoorTemp"));
    const before = await slider.inputValue();
    await slider.focus();
    await page.keyboard.press("End");
    const after = await slider.inputValue();
    expect(after).not.toBe(before);
    await page.reload();
    await page.locator("details.grp").nth(1).locator("summary").click();
    await expect(page.getByLabel(t("energy.settings.indoorTemp"))).toHaveValue(after);
  });

  test("sun: the date", async ({ page }) => {
    await open(page, routePath("cs", "sun"));
    const date = page.locator("input.sun-date");
    const before = await date.inputValue();
    const other = before.replace(/-\d\d-\d\d$/, before.endsWith("-12-21") ? "-03-20" : "-12-21");
    await date.fill(other);
    await expect.poll(() => stored(page, STORAGE_KEYS.sun)).not.toBeNull();
    await page.reload();
    await expect(page.locator("input.sun-date")).toHaveValue(other);
  });

  test("floor plan: the furniture of the visitor", async ({ page }) => {
    await open(page, routePath("cs", "plan"));
    await page.locator(".pl-bar .seg button").nth(2).click(); // my furniture
    await page.getByRole("group", { name: t("plan.furniture.presets") }).locator("button").first().click();
    await expect(page.locator("svg.plan-svg [data-item]")).toHaveCount(1);
    await page.reload();
    await expect(page.locator("svg.plan-svg [data-item]")).toHaveCount(1);
    await page.locator(".pl-bar .seg button").nth(2).click();
    await page.getByRole("button", { name: t("plan.furniture.clear") }).click();
    await expect(page.locator("svg.plan-svg [data-item]")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("svg.plan-svg [data-item]")).toHaveCount(0);
  });

  test("the colour scheme is kept", async ({ page }) => {
    await open(page, "/");
    const phone = await page.locator(".nav-toggle").isVisible();
    if (phone) await page.locator(".nav-toggle").click(); // the switch is inside the menu on a phone
    const button = page.locator(".icon-btn:visible").first();
    await button.click(); // system -> light
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await button.click(); // light -> dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await open(page, routePath("en", "budget"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // also on another page and in the other language
  });

  test("the colour scheme is applied by the inline script, before any bundle has run", async ({ page }) => {
    await open(page, "/");
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    // the application's scripts are replaced by empty ones: only the inline script in <head> can set the attribute
    await page.route("**/_next/static/**/*.js", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("storage that cannot be used", () => {
  const pages = (["plan", "model", "sun", "energy", "budget"] as const).map((key) => ({ key, path: routePath("cs", key) }));

  test("blocked storage: every page still works", async ({ page }) => {
    await page.addInitScript(() => {
      // what a private window or "block all cookies" does in some browsers: reaching for localStorage throws
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
    });
    for (const p of pages) {
      await open(page, p.path);
      await expect(page.locator("h1")).toBeVisible();
    }
    // and a control still works for the visit
    await open(page, routePath("cs", "budget"));
    const toggle = page.locator("section.budget-group input[role=switch]").first();
    // groups are closed `details` on phones: open the one that holds the switch
    await toggle.evaluate((el) => { const d = el.closest("details"); if (d) d.open = true; });
    const was = await toggle.isChecked();
    await toggle.setChecked(!was);
    await expect(toggle).toBeChecked({ checked: !was });
  });

  const bad: [string, string][] = [
    ["not JSON", "{this is not json"],
    ["JSON null", "null"],
    ["an array", "[1,2,3]"],
    ["a newer version", JSON.stringify({ v: 999, fp: null, data: { roof: false } })],
    ["a version of another type", JSON.stringify({ v: "1", fp: null, data: {} })],
    ["another model's fingerprint", JSON.stringify({ v: 1, fp: "00000000", data: { reserve: 0.5, groups: {}, overrides: { x: { quantity: 5 } } } })],
    ["unknown ids and wrong types", JSON.stringify({ v: 1, fp: null, data: { roof: "yes", day: 7, groups: { nope: true }, overrides: "no", panelCount: -3, enabledPlanes: [1, 2] } })],
  ];
  for (const [what, value] of bad) {
    test(`stored data that is ${what} is ignored`, async ({ page }, testInfo) => {
      // the reading code does not depend on the device: Chromium (desktop) and WebKit (iPhone 15) are enough
      test.skip(!["desktop", "iphone-15"].includes(testInfo.project.name), "the same on every device");
      await open(page, "/"); // an origin to store on
      await page.evaluate(([keys, v]) => { for (const k of keys) localStorage.setItem(k, v); }, [Object.values(STORAGE_KEYS), value] as const);
      for (const key of ["plan", "model", "sun", "energy", "budget"] as const) {
        await open(page, routePath("cs", key));
        await expect(page.locator("h1")).toBeVisible();
      }
      // the budget shows the book's own total: the reset button is disabled, nothing was applied
      await expect(page.locator("aside.budget-side .btn.ghost")).toBeDisabled();
    });
  }
});
