// End-to-end tests (docs/TESTING.md). Run with `npm run e2e` after `npm run build`: the production server is started on port 3401
// (or reused when it already runs). BASE_URL=http://localhost:3400 points the suite at another server (e.g. `next dev`) instead.
//
// Projects: desktop Chromium 1440x900, iPhone 15 and iPhone SE (WebKit), Pixel 7 (Chromium). A test title may carry a tag:
//   @desktop  only the desktop project (hover, keyboard-heavy flows)      @mobile  only the three phone projects
// Tests that need WebGL skip themselves when the browser has none (see helpers/stage.ts).
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = 3401;
const external = process.env.BASE_URL;
const baseURL = external ?? `http://localhost:${PORT}`;
const CI = !!process.env.CI;

// Headless Chromium on a Mac can use the GPU through ANGLE/Metal (a 3D page is ready in about 5 s); everywhere else (Linux CI) it draws
// WebGL with SwiftShader, in software (25 s and more, and every frame takes seconds). helpers/stage.ts reads the same switch.
const chromiumLaunch = {
  args: process.env.E2E_GPU === "1" || (process.platform === "darwin" && process.env.E2E_GPU !== "0")
    ? ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"]
    : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};

export default defineConfig({
  testDir: path.join(__dirname, "tests"),
  outputDir: path.join(__dirname, "test-results"),
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: path.join(__dirname, "playwright-report"), open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // a fixed colour scheme and no motion preference keep the pages deterministic
    colorScheme: "light",
  },
  projects: [
    {
      name: "desktop",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: chromiumLaunch },
    },
    { name: "iphone-15", grepInvert: /@desktop/, use: { ...devices["iPhone 15"] } },
    { name: "iphone-se", grepInvert: /@desktop/, use: { ...devices["iPhone SE"] } },
    { name: "pixel-7", grepInvert: /@desktop/, use: { ...devices["Pixel 7"], launchOptions: chromiumLaunch } },
  ],
  webServer: external
    ? undefined
    : {
        // `npm run build` must have run before (the .next folder is the production build)
        command: `npx next start -p ${PORT}`,
        cwd: path.resolve(__dirname, ".."),
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
