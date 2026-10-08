// The WebGL stage of the Model and Sun pages. Its container carries data-status: loading | ready | error | lost | unsupported.
// A browser without WebGL ends in "unsupported": the 3D tests then skip instead of failing, because that says nothing about the site.
import type { Locator, Page } from "@playwright/test";
import { test } from "./test";

/** Time allowed for the scene to build: software rendering of the shadow maps and the house is slow. */
export const STAGE_TIMEOUT = 120_000;

/**
 * Does the Chromium of this run have a GPU? Same rule as playwright.config.ts: on a Mac (Metal) yes, elsewhere SwiftShader in software
 * unless E2E_GPU=1 says the machine has one. WebKit always uses what the machine has (a GPU on a Mac).
 */
export const CHROMIUM_HAS_GPU = process.env.E2E_GPU === "1" || (process.platform === "darwin" && process.env.E2E_GPU !== "0");

/** Waits for the stage to leave "loading". Skips the test when WebGL is unavailable; fails on "error". Returns the stage locator. */
export async function readyStage(page: Page): Promise<Locator> {
  const stage = page.locator(".stage").first();
  await stage.waitFor({ timeout: STAGE_TIMEOUT });
  const handle = await page.waitForFunction(
    () => {
      const status = document.querySelector(".stage")?.getAttribute("data-status");
      return status && status !== "loading" ? status : null;
    },
    undefined,
    { timeout: STAGE_TIMEOUT, polling: 250 },
  );
  const status = await handle.jsonValue();
  test.skip(status === "unsupported", "This browser has no WebGL; the 3D scene cannot be tested here.");
  if (status !== "ready") throw new Error(`3D stage ended in status "${status}"`);
  return stage;
}

/** The projects that run the scene tests: one Chromium and one WebKit; the other two phones would only repeat them. */
export const SCENE_PROJECTS = ["desktop", "iphone-15"];
/**
 * The projects that also work the scene (pixels, switches, the walk, a lost context). Chromium joins when it has a GPU: with
 * SwiftShader one frame takes seconds, and every click waits for the page to be "stable" for longer than any sensible timeout.
 */
export const PIXEL_PROJECTS = CHROMIUM_HAS_GPU ? ["desktop", "iphone-15"] : ["iphone-15"];

/**
 * How much is going on in the picture of an element: the standard deviation of the brightness (0-255) of its pixels. A scene that
 * did not draw (or drew one flat colour) gives about 0; a house on a lawn under a sky gives tens.
 */
export async function contrastOf(page: Page, element: Locator): Promise<number> {
  const png = (await element.screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let n = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < data.length; i += 16) { // every fourth pixel
      const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++; sum += y; sum2 += y * y;
    }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  }, png);
}

/**
 * Loses the WebGL context of the stage the way a browser does under memory pressure. The extension object is kept on the window:
 * once the context is lost, getExtension() returns null, and restoreContext() is needed on the same object.
 */
export const loseContext = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __loseContext?: WEBGL_lose_context };
    const canvas = document.querySelector<HTMLCanvasElement>(".stage canvas")!;
    w.__loseContext = (canvas.getContext("webgl2") as WebGL2RenderingContext).getExtension("WEBGL_lose_context")!;
    w.__loseContext.loseContext();
  });

/** Gives the context back, as the browser does when the memory is free again. */
export const restoreContext = (page: Page) => page.evaluate(() => (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext.restoreContext());
