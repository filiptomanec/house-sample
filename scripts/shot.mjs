// Screenshot helper for visual checks: node scripts/shot.mjs <url> <out.png> [--device desktop|iphone15|se|pixel7] [--full] [--wait ms] [--scroll px] [--click selector] [--dark]
import { chromium, webkit, devices } from "@playwright/test";

const args = process.argv.slice(2);
const [url, out] = args;
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [--device desktop|iphone15|se|pixel7] [--full] [--wait ms] [--scroll px] [--click selector] [--dark]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
};
const device = opt("device", "desktop");
const wait = Number(opt("wait", "1500"));
const scroll = Number(opt("scroll", "0"));
const click = opt("click", "");
const full = args.includes("--full");
const dark = args.includes("--dark");

const profiles = {
  desktop: { engine: chromium, ctx: { viewport: { width: 1440, height: 900 } } },
  iphone15: { engine: webkit, ctx: { ...devices["iPhone 15"] } },
  se: { engine: webkit, ctx: { ...devices["iPhone SE"] } },
  pixel7: { engine: chromium, ctx: { ...devices["Pixel 7"] } },
};
const p = profiles[device] ?? profiles.desktop;
const browser = await p.engine.launch({ args: p.engine === chromium ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [] });
const ctx = await browser.newContext({ ...p.ctx, colorScheme: dark ? "dark" : "light" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(m.type() + ": " + m.text().slice(0, 300)); });
page.on("pageerror", (e) => logs.push("pageerror: " + String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "load", timeout: 60000 });
if (click) await page.click(click).catch((e) => logs.push("click failed: " + String(e).slice(0, 200)));
if (scroll) await page.evaluate((y) => window.scrollTo(0, y), scroll);
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: full });
await browser.close();
console.log("saved " + out + (logs.length ? "\nconsole:\n" + logs.slice(0, 12).join("\n") : "\nconsole: clean"));
