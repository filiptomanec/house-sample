// A lost graphics context (phones do this under memory pressure): the stage of the Model and Sun pages says so, takes the context back
// when the browser returns it, and offers a button that rebuilds the scene without reloading the page. Needs a GPU for the scene to
// answer quickly; see the header of scene.spec.ts for which projects run it.
import { getT } from "../../src/lib/i18n/server";
import { PIXEL_PROJECTS, SCENE_PROJECTS, contrastOf, loseContext, readyStage, restoreContext } from "../helpers/stage";
import { open, routePath } from "../helpers/site";
import type { TestInfo } from "@playwright/test";
import { expect as baseExpect, test, type Page } from "../helpers/test";

const expect = baseExpect.configure({ timeout: 45_000 });

// Some browsers log the loss we cause on purpose. KNOWN ISSUE: now and then (about 1 run in 10 in Chromium) the loss falls in the
// middle of a shader compile and three.js throws "Cannot read properties of null (reading 'trim')" from getProgramInfoLog of the lost
// context; the scene recovers all the same. The tests wait for the scene to settle first, and note the error when it still happens.
test.use({ webgl: true, ignoreProblems: /context lost|CONTEXT_LOST|reading 'trim'/i });
test.describe.configure({ timeout: 150_000 });
test.beforeEach(({}, testInfo) => {
  test.skip(!SCENE_PROJECTS.includes(testInfo.project.name) || !PIXEL_PROJECTS.includes(testInfo.project.name), "needs a project with a GPU (see scene.spec.ts)");
});

const t = getT("cs");
const KNOWN = "three.js reads the info log of a shader program after the context was lost (uncaught TypeError: reading 'trim' of null); seen in about 1 run in 10";

/** Remembers the known error when it happens, in the report. */
function watchKnownError(page: Page, testInfo: TestInfo) {
  page.on("pageerror", (e) => {
    if (/reading 'trim'/.test(e.message) && !testInfo.annotations.some((a) => a.type === "known-issue")) testInfo.annotations.push({ type: "known-issue", description: KNOWN });
  });
}

test("model: the stage says so, restores itself when the browser gives the context back, and a button rebuilds it", async ({ page }, testInfo) => {
  watchKnownError(page, testInfo);
  await open(page, routePath("cs", "model"));
  const stage = await readyStage(page);
  await page.waitForTimeout(2000); // the furniture and the shadows load a moment after the building

  // 1. the browser takes the context away and gives it back by itself
  await loseContext(page);
  await expect(stage).toHaveAttribute("data-status", "lost");
  await expect(stage.locator(".stage-msg")).toContainText(t("model.stage.lost"));
  await restoreContext(page);
  await expect(stage).toHaveAttribute("data-status", "ready", { timeout: 30_000 });

  // 2. the context stays lost: the visitor presses the button and the scene is rebuilt without a reload
  await loseContext(page);
  await expect(stage).toHaveAttribute("data-status", "lost");
  const restore = stage.getByRole("button", { name: t("model.stage.restore") });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(stage).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await page.waitForTimeout(800);
  expect(await contrastOf(page, stage), "the rebuilt scene draws something").toBeGreaterThan(6);
});

test("sun: the same recovery", async ({ page }, testInfo) => {
  watchKnownError(page, testInfo);
  await open(page, routePath("cs", "sun"));
  const stage = await readyStage(page);
  await page.waitForTimeout(1000);
  await loseContext(page);
  await expect(stage).toHaveAttribute("data-status", "lost");
  await expect(stage.locator(".stage-msg")).toContainText(t("sun.stage.lost"));
  await stage.getByRole("button", { name: t("sun.stage.restore") }).click();
  await expect(stage).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
});
