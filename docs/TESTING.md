# Testing

Three layers, from fast to slow:

| Layer | Command | What it covers |
| --- | --- | --- |
| Type check and lint | `npm run typecheck && npm run lint` | `src/`, `scripts/`, `e2e/` |
| Unit tests (Vitest) | `npm test` | the model, the calc modules, the i18n layer, routes, styles; invariants and independent oracles |
| End-to-end (Playwright) | `npm run build && npm run e2e` | the built site in real browsers, in both languages |

This document is about the third layer. Everything lives in `e2e/`.

## Running

```
npm run build          # the tests run against the production build, not against `next dev`
npm run e2e            # = playwright test -c e2e/playwright.config.ts
npx playwright test -c e2e/playwright.config.ts budget --project=desktop   # one spec, one project
npx playwright show-report e2e/playwright-report                          # the HTML report of the last run
```

* `webServer` starts `npx next start -p 3401` and waits for it; a server that already runs on port 3401 is reused.
* `BASE_URL=http://localhost:3400 npm run e2e` runs the suite against another server (for example `next dev`) and starts nothing.
  Prefetching, caching and some console messages differ in development; the suite is written for the production build.
* Browsers: `npx playwright install chromium webkit` (once). The browsers are not part of `npm install`.
* A whole run takes about five minutes on a laptop (four workers; two in CI). Reports and traces of failed tests are written to
  `e2e/playwright-report/` and `e2e/test-results/` (both ignored by git); CI uploads the report when the job fails.

## Projects (devices)

| Project | Browser | Viewport |
| --- | --- | --- |
| `desktop` | Chromium | 1440 x 900 |
| `iphone-15` | WebKit | iPhone 15 (393 x 659, touch) |
| `iphone-se` | WebKit | iPhone SE (320 x 568, touch) |
| `pixel-7` | Chromium | Pixel 7 (touch) |

A tag in a test title restricts it: `@desktop` runs on the desktop project only (hover and keyboard flows, and every test that
talks plain HTTP and would only repeat itself four times), `@mobile` on the three phones only.

## Specs

| File | What it checks |
| --- | --- |
| `smoke.spec.ts` | every page in `cs` and `en`: status 200, `<html lang>`, title, exactly one `h1`, description, canonical and `hreflang`, no console errors, no sideways scroll; titles unique per language |
| `navigation.spec.ts` | the bar (wide screens) or the menu (phones) lists every page with the right address and marks the current one; menu keyboard behaviour; the language switch keeps the page; the 404 page |
| `routing.spec.ts` | HTTP level: root is Czech, `/en/...`, localised slugs, other spellings redirect (308) to the canonical address, unknown addresses answer 404 |
| `headers.spec.ts` | `model/vnd.usdz+zip` for AR Quick Look, GLB type and cache, immutable media and built assets, `robots.txt`, `sitemap.xml`, web manifest and icons |
| `media.spec.ts` | every file named by `public/media/manifest.json` and `public/models/manifest.json` exists, has the recorded size and hash, is the right kind of file, is served, and nothing is left unreferenced |
| `a11y.spec.ts` | landmarks, heading order, unique ids, names of all controls (from the browser's accessibility tree), skip link, visible keyboard focus |
| `mobile.spec.ts` | touch targets of at least 44 px, text fields of at least 16 px (no iOS zoom), nothing wider than the screen after scrolling |
| `plan.spec.ts` | rooms of the drawing and the table are the rooms of the model; selecting by pointer, table and arrow keys; measuring |
| `budget.spec.ts` | headline and side totals agree; an optional group, the reserve and an edited quantity move the total; reset; the CSV file |
| `energy.spec.ts` | sliders and typed prices change the results; reset; month buttons; PV size of the model |
| `sun.spec.ts` | day presets and the date field show the day length the calc module gives; time slider; play and stop |
| `model.spec.ts` | layer switches and their storage entry, camera presets, GLB and AR links, the STL download (byte for byte what `printModel` builds, ASCII header with the project name only) |
| `gallery.spec.ts` | a tile per still with its alt text, filters, lightbox open, page, close with Escape, focus returns to the tile |
| `persistence.spec.ts` | choices survive a reload; the colour scheme is applied by the inline script before any bundle runs; blocked, corrupt, outdated or foreign storage is ignored without errors |
| `scene.spec.ts` | the Model and Sun scenes build and draw (WebGL); switches and presets change the picture; the Sun analysis runs |
| `webgl-context-loss.spec.ts` | a lost graphics context: the stage says so, takes the context back, and the button rebuilds the scene |

Numbers are never typed into a test. Expected values come from the model (`src/lib/model/instance`), the calc modules, the
dictionaries (`getT(locale)`), the routes module and the manifests, imported through relative paths.

## The `test` object (`e2e/helpers/test.ts`)

Import `test` and `expect` from `../helpers/test`, not from `@playwright/test`. Its `page` carries a guard that fails the test on:

* any `console.error`, an uncaught page error, or a message that looks like a hydration warning (including the minified React codes);
* any HTTP status of 400 or more for any request (a test that expects one, such as the 404 page, lists it in `ignoreProblems`).

Options, set with `test.use({ ... })`:

* `ignoreProblems: RegExp` - problems the test accepts on purpose.
* `webgl: true` - give the page the browser's real WebGL. **The default is `false`**: the page then finds no WebGL, the 3D stage
  answers "unsupported" at once and does not build a scene. Everything that is not about the scene is tested that way, because
  building a scene costs seconds of CPU.

The guard lives in the `page` fixture, so tests that only use `request` (HTTP) open no browser page.

## 3D tests and the GPU

`helpers/stage.ts` waits for `.stage[data-status]` to leave `loading`; `unsupported` skips the test, `error` fails it.

* WebKit (iPhone 15) uses the machine's GPU.
* Headless Chromium uses the GPU through ANGLE/Metal on a Mac (a 3D page is ready in about 5 s). Everywhere else it draws with
  SwiftShader in software: 25 s and more to build the scene, and every frame takes seconds, so clicks wait for the page to be
  "stable" for longer than any sensible timeout. On such a machine only the "scene builds" tests run in Chromium and the tests that
  work the scene run in WebKit. `E2E_GPU=1` / `E2E_GPU=0` overrides the detection (`playwright.config.ts` and `helpers/stage.ts` read it).
* The pixels of a scene are checked by the contrast of an element screenshot (`contrastOf`) and by comparing screenshots before and
  after a switch, never against stored images.

## Known issues the suite reports

Found by the tests, not fixed by them. They do not turn the run red, but each leaves a `known-issue` annotation in the report (the
note while the problem exists, "FIXED: remove the entry" once it is gone). The list is `e2e/helpers/known-issues.ts` plus two
allowances in `helpers/test.ts` and one in `routing.spec.ts` / `gallery.spec.ts`:

* **Language switch prefetch.** On English pages the link to the Czech page is prefetched with the segment path `/$d$locale/__PAGE__`
  and the production server answers 404 (one failed request and one console line per page view). Suggested fix: `prefetch={false}`
  on the links of `LanguageSwitch` (switching language changes the root layout, so it is a full page load anyway).
* **Sideways scroll, iPhone SE, `/en/floor-plan`.** The toolbar (`.pl-bar`) is 23 px wider than the 320 px screen.
* **Heading levels, Sun page.** The side panel uses `h3` straight after the `h1`.
* **Touch targets.** The two point selectors of the measuring panel on the Plot page are 26 px high on touch screens; on the
  568 px high iPhone SE the menu entries shrink to 42 px.
* **Soft 404.** A known page with something appended (`/pudorys/extra`) is rewritten without the 404 status: the 404 page is served
  with status 200.
* **Unhandled view-transition rejection.** Opening and closing the gallery lightbox at once raises "Transition was skipped" as an
  uncaught error in Chromium (`gallery/morph.ts` does not catch the rejected promises).
* **Lost context during a shader compile.** In about one run in ten of the context-loss test in Chromium, three.js throws an uncaught
  "Cannot read properties of null (reading 'trim')" because the loss falls into the middle of a shader compile; the scene recovers.
* **WebKit noise.** WebKit reports a request that a navigation cancelled as a page error "... due to access control checks";
  the guard ignores exactly that text.

## Writing a test

1. Put it in `e2e/tests/<topic>.spec.ts`; import `{ expect, test }` from `../helpers/test` and `open(page, path)` from `../helpers/site`
   (it waits for hydration).
2. Get addresses from `routePath(locale, key)`, texts from `getT(locale)`, numbers from the model. No literal numbers of the house.
3. Locate by role, label or a stable class; never by position when a label exists. The navigation is a bar on wide screens and a
   menu on phones: use `navigation(page)` and `pageLinks(...)`.
4. Slow or repetitive work goes under a tag (`@desktop`), or skips itself with a reason: `test.skip(condition, "why")`.
5. Run `npx tsc --noEmit && npx eslint e2e` (the folder is part of the type check and the lint).

## Privacy

Tests and their output contain nothing about real buildings, people or places. The STL test asserts that the file header names the
project and the scale and nothing else; the storage tests write only synthetic values.
