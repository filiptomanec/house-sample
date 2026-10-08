// The WebGL scenes of the Model and Sun pages with a real graphics context. A browser without WebGL skips these tests.
//
//  * Every WebGL-capable project (desktop Chromium, iPhone 15) checks that both scenes build and reach "ready".
//  * The tests that work the scene (pixels, switches, the walk, the analysis) run on the iPhone 15 (WebKit, which
//    draws with the machine's GPU) and, where Chromium has a GPU too (a Mac: Metal), on the desktop. Chromium without a GPU draws with
//    SwiftShader in software, one frame takes seconds, and every click then waits for the page to be "stable" for longer than any
//    sensible timeout. The two phone projects that are not listed would only repeat the iPhone 15.
import { getT } from "../../src/lib/i18n/server";
import { PIXEL_PROJECTS, SCENE_PROJECTS, contrastOf, readyStage } from "../helpers/stage";
import { open, routePath } from "../helpers/site";
import { expect as baseExpect, test } from "../helpers/test";

// scenes are slow to build and to answer, so the waiting of every assertion in this file is longer than the default
const expect = baseExpect.configure({ timeout: 45_000 });

test.use({ webgl: true });
test.describe.configure({ timeout: 150_000 });
test.beforeEach(({}, testInfo) => {
  test.skip(!SCENE_PROJECTS.includes(testInfo.project.name), "the scene tests run on the desktop Chromium and the iPhone 15 only");
});
/** Skips a test that works the scene on a project that has no GPU. */
const needsGpu = (project: string) => test.skip(!PIXEL_PROJECTS.includes(project), "works the scene: needs a GPU (see the header of this file)");

const t = getT("cs");
const MIN_CONTRAST = 6;

test.describe("the scenes build", () => {
  test("model", async ({ page }) => {
    await open(page, routePath("cs", "model"));
    const stage = await readyStage(page);
    await expect(stage.locator("canvas")).toHaveAttribute("aria-label", t("model.stage.canvas"));
    await expect(stage.locator(".compass")).toBeVisible();
  });

  test("sun", async ({ page }) => {
    await open(page, routePath("cs", "sun"));
    const stage = await readyStage(page);
    await expect(stage.locator("canvas")).toHaveAttribute("aria-label", t("sun.stage.canvas"));
  });
});

test.describe("model scene", () => {
  test("draws something, and the roof switch changes the picture", async ({ page }, testInfo) => {
    needsGpu(testInfo.project.name);
    await open(page, routePath("cs", "model"));
    const stage = await readyStage(page);
    await page.waitForTimeout(800); // let shadows and the furniture settle
    expect(await contrastOf(page, stage), "the scene draws something").toBeGreaterThan(MIN_CONTRAST);

    const before = await stage.screenshot();
    await page.getByRole("switch", { name: t("model.layers.roof") }).setChecked(false);
    await expect.poll(async () => !(await stage.screenshot()).equals(before), { timeout: 15_000 }).toBe(true);
  });

  test("a camera preset moves the view and the walk mode starts and stops", async ({ page }, testInfo) => {
    needsGpu(testInfo.project.name);
    await open(page, routePath("cs", "model"));
    const stage = await readyStage(page);
    await page.waitForTimeout(500);
    const before = await stage.screenshot();
    await page.locator(".model-views .chip").nth(1).click();
    await expect(page.locator(".model-views .chip").nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => !(await stage.screenshot()).equals(before), { timeout: 15_000 }).toBe(true);

    const walk = page.locator("button.model-walk");
    await expect(walk).toBeEnabled();
    await walk.click();
    await expect(walk).toHaveText(t("model.walk.stop"));
    await walk.click();
    await expect(walk).toHaveText(t("model.walk.start"));
  });
});

test.describe("sun scene", () => {
  test("draws, analyses the day, and another day gives other results", async ({ page }, testInfo) => {
    needsGpu(testInfo.project.name);
    await open(page, routePath("cs", "sun"));
    const stage = await readyStage(page);
    await page.waitForTimeout(500);
    expect(await contrastOf(page, stage), "the scene draws something").toBeGreaterThan(MIN_CONTRAST);
    // the ray-cast analysis ran: the chart of the day appears and the bars hold numbers
    await expect(page.locator(".sun-day-panel")).toBeVisible({ timeout: 60_000 });
    const bars = page.locator(".sun-results").first();
    const before = await bars.innerText();
    await page.locator(".sun-day-pick .seg button").nth(3).click(); // another reference day
    await expect.poll(async () => (await bars.innerText()) !== before, { timeout: 60_000 }).toBe(true);
  });
});
