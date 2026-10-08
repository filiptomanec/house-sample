// The `test` of the suite: Playwright's test plus an automatic guard that fails a test when the page logged a console error,
// threw an uncaught error, reported a hydration problem or received an HTTP error for any request.
//
// Options (set with test.use):
//   ignoreProblems  a RegExp for problems this test accepts on purpose (matched against the text the guard records)
//   webgl           false (default): the page sees no WebGL, so the 3D stage reports "unsupported" at once instead of building a scene
//                   (software rendering would hog the CPU for seconds); true: the browser's real WebGL, for the tests of the 3D pages
import { test as base, expect } from "@playwright/test";

/** React's hydration mismatch in development text, and the minified production codes (418 text, 423 / 425 recoverable, 419 suspense). */
const HYDRATION = /hydrat|did not match|Minified React error #(?:418|419|423|425)\b/i;

/**
 * WebKit reports a request that the navigation (or the end of the test) cancelled while it was in flight, an RSC prefetch or a
 * lazily fetched image, as an uncaught page error "... due to access control checks", even when the code catches the rejection.
 * (These are same-origin requests; a real access-control failure would show up as a failed request or a console error as well.)
 */
const CANCELLED_PREFETCH = /\S+ due to access control checks/;

type Fixtures = {
  ignoreProblems: RegExp | null;
  webgl: boolean;
};

export const test = base.extend<Fixtures>({
  ignoreProblems: [null, { option: true }],
  webgl: [false, { option: true }],

  // The guard lives in the `page` fixture, so tests that only talk HTTP (the `request` fixture) never open a browser page.
  page: async ({ page, webgl, ignoreProblems }, provide) => {
    if (!webgl) {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          if (/webgl/i.test(type)) return null;
          return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
        } as typeof original;
      });
    }

    const found: string[] = [];
    const add = (text: string) => {
      if (!ignoreProblems?.test(text)) found.push(text);
    };
    page.on("console", (m) => {
      const text = m.text();
      if (m.type() === "error" || HYDRATION.test(text)) add(`console.${m.type()}: ${text.slice(0, 300)}`);
    });
    page.on("pageerror", (e) => {
      if (CANCELLED_PREFETCH.test(e.message)) return;
      add(`pageerror: ${e.message.slice(0, 300)}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400) add(`HTTP ${r.status()} ${r.url()}`);
    });

    await provide(page);
    expect(found, "console errors, uncaught errors, hydration warnings and HTTP errors").toEqual([]);
  },
});

export { expect };
export type { Page, Locator } from "@playwright/test";
