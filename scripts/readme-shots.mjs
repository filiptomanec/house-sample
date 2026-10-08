// Makes the screenshots of the README (docs/img/*.jpg) from a running copy of the site.
//
//   node scripts/readme-shots.mjs [--base http://localhost:3400] [--only id,id] [--out docs/img] [--limit 120] [--list]
//
// Start the site first (`npm run dev`, or `npm run build && npm start` and --base http://localhost:3401). The script needs the
// Playwright browsers (`npx playwright install chromium webkit`) and ImageMagick (`magick`). Every shot is a real page in a real
// browser (desktop Chromium 1440 x 900, iPhone 15 in WebKit; light and dark scheme), encoded as a progressive JPEG without
// metadata and never larger than --limit KB (the quality, and if needed the width, are lowered until it fits). Run it again
// whenever the renders or the pages change: the files are overwritten, the README links stay the same.
import { chromium, webkit, devices } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The shots. `path` is the public English URL; `width` is the width of the file (the page is wider on desktop). */
const SHOTS = [
  { id: "home-desktop-light", path: "/en", device: "desktop", scheme: "light", wait: 3000, width: 1200 },
  { id: "plan-desktop-dark", path: "/en/floor-plan", device: "desktop", scheme: "dark", wait: 1500, width: 1200 },
  { id: "plan-desktop-light", path: "/en/floor-plan", device: "desktop", scheme: "light", wait: 1500, width: 1200 },
  { id: "model-desktop-light", path: "/en/model", device: "desktop", scheme: "light", stage: true, wait: 2500, width: 1200 },
  { id: "model-desktop-dark", path: "/en/model", device: "desktop", scheme: "dark", stage: true, wait: 2500, width: 1200 },
  { id: "sun-desktop-light", path: "/en/sun", device: "desktop", scheme: "light", stage: true, wait: 4000, width: 1200 },
  { id: "energy-desktop-light", path: "/en/energy", device: "desktop", scheme: "light", wait: 2000, width: 1200 },
  { id: "budget-desktop-light", path: "/en/budget", device: "desktop", scheme: "light", wait: 2000, width: 1200 },
  { id: "home-iphone-light", path: "/en", device: "iphone", scheme: "light", wait: 3000, width: 520 },
  { id: "model-iphone-dark", path: "/en/model", device: "iphone", scheme: "dark", stage: true, wait: 2500, width: 520 },
  { id: "sun-iphone-light", path: "/en/sun", device: "iphone", scheme: "light", stage: true, wait: 4000, width: 520 },
  { id: "energy-iphone-dark", path: "/en/energy", device: "iphone", scheme: "dark", wait: 2000, width: 520 },
];

const DEVICES = {
  desktop: { engine: chromium, context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  iphone: { engine: webkit, context: { ...devices["iPhone 15"] } },
};
// Chromium without a GPU draws WebGL in software with SwiftShader.
const SOFTWARE_GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
/** The Next.js development indicator must not appear in a picture; the rule is harmless on a production build. */
const HIDE_DEV_UI = "nextjs-portal, #__next-build-watcher { display: none !important; }";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const base = opt("base", "http://localhost:3400").replace(/\/$/, "");
const outDir = path.resolve(ROOT, opt("out", "docs/img"));
const limitBytes = Number(opt("limit", "120")) * 1024;
const only = opt("only", "")?.split(",").filter(Boolean);

if (args.includes("--list")) {
  for (const s of SHOTS) console.log(`${s.id}  ${s.device}  ${s.scheme}  ${s.path}`);
  process.exit(0);
}

/** PNG buffer to progressive JPEG without metadata, at most `limit` bytes: lower the quality, then the width. */
function encodeJpeg(png, width, limit) {
  const magick = (w, q) =>
    spawnSync("magick", ["png:-", "-resize", `${w}x>`, "-strip", "-interlace", "Plane", "-sampling-factor", "4:2:0", "-quality", String(q), "jpg:-"], {
      input: png,
      maxBuffer: 64 * 1024 * 1024,
    });
  for (let w = width; w >= 320; w = Math.round(w * 0.85)) {
    for (let q = 84; q >= 50; q -= 6) {
      const r = magick(w, q);
      if (r.error || r.status !== 0) throw new Error(`ImageMagick (magick) failed: ${r.error?.message ?? r.stderr?.toString().slice(0, 200)}`);
      if (r.stdout.length <= limit) return { jpeg: r.stdout, width: w, quality: q };
    }
  }
  throw new Error(`cannot fit the image into ${limit} bytes`);
}

async function shoot(browsers, shot) {
  const profile = DEVICES[shot.device];
  let browser = browsers.get(profile.engine);
  if (!browser) {
    browser = await profile.engine.launch({ args: profile.engine === chromium ? SOFTWARE_GL : [] });
    browsers.set(profile.engine, browser);
  }
  const context = await browser.newContext({ ...profile.context, colorScheme: shot.scheme, locale: "en-GB" });
  const problems = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`page error: ${String(e).slice(0, 160)}`));
    await page.goto(base + shot.path, { waitUntil: "load", timeout: 60_000 });
    await page.addStyleTag({ content: HIDE_DEV_UI });
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    if (shot.stage) {
      await page.waitForSelector('.stage[data-status="ready"]', { timeout: 45_000 }).catch(() => problems.push("3D stage was not ready in 45 s"));
    }
    await page.waitForTimeout(shot.wait ?? 1500);
    const png = await page.screenshot({ type: "png" });
    const { jpeg, width, quality } = encodeJpeg(png, shot.width, limitBytes);
    const file = path.join(outDir, `${shot.id}.jpg`);
    writeFileSync(file, jpeg);
    console.log(`${shot.id}.jpg  ${width} px  q${quality}  ${(statSync(file).size / 1024).toFixed(0)} KB${problems.length ? `  [${problems.join("; ")}]` : ""}`);
  } finally {
    await context.close();
  }
}

const todo = SHOTS.filter((s) => !only?.length || only.includes(s.id));
if (!todo.length) {
  console.error(`no shot matches --only (known ids: ${SHOTS.map((s) => s.id).join(", ")})`);
  process.exit(2);
}
if (spawnSync("magick", ["-version"]).error) {
  console.error("ImageMagick (`magick`) is required to encode the images.");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const browsers = new Map();
let failed = 0;
try {
  for (const shot of todo) {
    try {
      await shoot(browsers, shot);
    } catch (e) {
      failed++;
      console.error(`${shot.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
} finally {
  for (const b of browsers.values()) await b.close();
}
process.exit(failed ? 1 : 0);
