// Posters of the 3D pages: the first view of the web scene of /model and /sun, captured from the running site, so a page can show
// the house while the 3D engine loads (contract C4 `posters`). Run it against the production build (P3), then let the media build
// encode the captures and name them in the manifest:
//
//   npm run build && npm start                                  (port 3401)
//   node scripts/posters.mjs [--base http://localhost:3401] [--out pipeline/out/posters] [--pages model,sun] [--wait 2500]
//   npx tsx scripts/build-media.ts --only posters               (WebP posters into public/media + manifest.json)
//
// For every page a desktop capture (1440 x 900 CSS px at DPR 2) and a phone capture (393 x 852 at DPR 3, touch) of the stage
// canvas alone: everything drawn over the canvas (labels, the compass, buttons) is hidden for the capture. The pages are opened by
// their route keys ("/cs/<key>"), which the site redirects to the canonical address, so no slug is written here. Chromium with
// SwiftShader renders WebGL without a GPU. Exit code 0 when every capture was written, 1 otherwise, 2 for bad usage.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const known = new Set(["--base", "--out", "--pages", "--wait", "--timeout"]);
for (let i = 0; i < args.length; i += 2) {
  if (!known.has(args[i])) {
    console.error(`unknown option ${args[i]}\nusage: node scripts/posters.mjs [--base url] [--out dir] [--pages model,sun] [--wait ms] [--timeout ms]`);
    process.exit(2);
  }
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const base = opt("base", "http://localhost:3401").replace(/\/+$/, "");
const out = path.resolve(root, opt("out", "pipeline/out/posters"));
const pages = opt("pages", "model,sun").split(",").filter(Boolean);
const settle = Number(opt("wait", "2500"));
const timeout = Number(opt("timeout", "120000"));
const PAGES = new Set(["model", "sun"]);
for (const p of pages) {
  if (!PAGES.has(p)) {
    console.error(`unknown page ${p} (pages with a 3D stage: ${[...PAGES].join(", ")})`);
    process.exit(2);
  }
}

/** The two devices of the posters (the same names as the manifest's `posters.<page>.<device>`). */
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

/** Everything inside the stage except the canvas is hidden for the capture (visibility keeps the layout as it is). */
const HIDE_OVERLAYS = ".stage *:not(canvas) { visibility: hidden !important; } .stage canvas { visibility: visible !important; }";

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let failed = 0;
try {
  for (const page of pages) {
    for (const [device, ctxOpts] of Object.entries(DEVICES)) {
      const ctx = await browser.newContext({ ...ctxOpts, colorScheme: "light", reducedMotion: "reduce" });
      const tab = await ctx.newPage();
      const file = path.join(out, `${page}-${device}.png`);
      try {
        await tab.goto(`${base}/cs/${page}`, { waitUntil: "load", timeout });
        const stage = tab.locator(".stage").first();
        await stage.waitFor({ state: "attached", timeout });
        await tab.waitForSelector('.stage[data-status="ready"]', { timeout });
        await stage.scrollIntoViewIfNeeded();
        await tab.addStyleTag({ content: HIDE_OVERLAYS });
        await tab.waitForTimeout(settle); // the scene renders on demand: let the first frames and the fit settle
        const canvas = tab.locator(".stage canvas").first();
        await canvas.screenshot({ path: file, animations: "disabled" });
        const { width, height } = (await canvas.boundingBox()) ?? { width: 0, height: 0 };
        console.log(`${path.relative(root, file)}: ${Math.round(width)} x ${Math.round(height)} CSS px at DPR ${ctxOpts.deviceScaleFactor}`);
      } catch (e) {
        failed++;
        console.error(`${page} ${device}: ${String(e).split("\n")[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
if (failed) console.error(`${failed} captures failed`);
else console.log(`posters captured; next: npx tsx scripts/build-media.ts --only posters`);
process.exit(failed ? 1 : 0);
