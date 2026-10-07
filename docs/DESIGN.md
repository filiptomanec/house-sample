# House Sample: design system

Graphite, ivory and mint. Geist (sans and mono), no serif, no orange, amber, honey or terracotta. Calm, precise, a
little technical: a drawing-office feel with generous space. This document is the contract for everyone who writes
UI; `src/styles/tokens.css` is the single source of the values.

## 1. Where things live

```
src/styles/
  index.css            the only entry point (imported once by src/app/[locale]/layout.tsx)
  reset.css            Tailwind preflight in the `base` layer, nothing else from Tailwind
  tokens.css           every colour, size, space, radius, shadow, z-index, motion value and breakpoint
  base.css             document, type scale, focus, selection, .sr-only, skip link, reduced motion
  layout.css           .shell .section .panel .stack .cols-2 .kicker .tool-head .index .split-head
  components/          buttons, nav, footer, controls, data (stat, kv, table, bars, legend), states, motion
  pages/<page>.css     page-specific rules; imported by the page itself, never from index.css
  breakpoints.ts       the three breakpoints and ready-made media query strings for JS
  tokens.ts            readToken() / readTokens() / onSchemeChange(): tokens for canvas and three.js
  color.ts             contrast, hue and token parsing (used by the tests)
src/components/        Nav, Footer, Reveal, LanguageSwitch, ui/{controls,inputs,display,ThemeSwitch,StateViews,numeric}
src/lib/i18n/          locales, dictionaries, t(), formatting (see section 8)
model/style.json       materials and looks for the web and Blender (section 9)
```

Rules:

* **No colour literals outside `tokens.css`.** No hex or `rgb()` in TSX or component CSS. A canvas or three.js scene asks
  for a token: `readToken("--zone-day")` returns the colour of the current scheme as `rgb(...)`.
* **No patch layers.** A component is styled in its own file; a later rule never "fixes" an earlier one. Page CSS may
  compose tokens and layout classes, not override components with `!important` (the only `!important` is the 16 px font
  of touch inputs, which must beat inline sizes).
* **One set of breakpoints** (section 4). Anything else fails `tokens.test.ts`.
* **Touch targets are 44 px** (`--touch`) on `(pointer: coarse)`: buttons, chips, segments, inputs, sliders, summaries.
* **Motion respects `prefers-reduced-motion`**: transitions collapse, `.rv` content stays visible.
* **Numbers and units never wrap** (`nbsp`), numbers are tabular (`.num`, `.mono`, `.stat .v`).

## 2. Colour

### 2.1 Palette

| Role | Light | Dark | Tokens |
|---|---|---|---|
| Page, recessed, card, raised | ivory `#f4f1e8`, `#eae6da`, `#fbfaf5`, white | graphite `#14171a`, `#1b1f23`, `#1f2428`, `#272d32` | `--bg --bg-2 --surface --surface-2` |
| Ink | `#1b1e21` `#454a50` `#596067` | `#eeeadf` `#bcb8ad` `#9a9a93` | `--ink --ink-2 --ink-3` |
| Rules, scrim | graphite at 12 % and 22 % | ivory at 12 % and 24 % | `--rule --rule-2 --scrim` |
| Mint | graphics `#12906b`, text `#0a6a4c`, tint `#d4efe3` | graphics `#52d4a8`, text `#7fe6c2`, tint `#1d3a31` | `--accent --accent-ink --accent-soft --focus` |
| Solid mint (same in both) | `#5fd6ae` with `#0e1b16` on it | | `--mint --on-mint` |
| State | green, red, blue | lighter | `--good --bad --info` |

Domain tokens (all with a light and a dark value):

* **Zones** (floor plan fills, labels in `--ink`): `--zone-day --zone-night --zone-service --zone-circulation --zone-garage --zone-terrace`.
  Plan drawing: `--plan-window --plan-door --plan-dim --plan-fixture` (walls are drawn with `var(--ink)`).
* **Data series** (charts): `--series-load --series-pv --series-battery --series-grid --series-heat --series-export --series-saving`;
  categorical set `--cat-1 ... --cat-8`.
* **Sun**: `--sun-lit --sun-shade --sun-disc --sun-summer --sun-equinox --sun-winter`, sky `--sky-top --sky-bottom`, 3D backdrop `--stage-bg`.
* **Plot map**: `--map-plot --map-plot-line --map-setback --map-house --map-roof --map-neighbour --map-road --map-paving --map-lawn --map-tree --map-contour`.
* **On photos and renders** (same in both schemes): `--on-media --media-scrim --media-scrim-lo`.

### 2.2 Schemes

The scheme follows the system (`prefers-color-scheme`) and can be forced with `<html data-theme="light|dark">`. The theme
switch (`ui/ThemeSwitch.tsx`) cycles system, light, dark and stores a forced choice in `localStorage` (every access in
`try/catch`); `THEME_SCRIPT` in `<head>` applies it before first paint, so nothing flashes.

* `.night`: a block that is dark in both schemes (hero, gallery, menu): dark tokens, `--bg` background, `--ink` text.
* `.scheme-dark`: only the dark tokens for a subtree (the navigation bar over a dark hero carries it).
* The dark values are written twice in `tokens.css` (forced block and media query). `tokens.test.ts` keeps both identical.
* Tokens are plain values per scheme, **not** `light-dark()`: Lightning CSS (Next's minifier) rewrites `light-dark()`
  into toggles that are resolved at `:root` and would ignore `.night`. The test fails if `light-dark(` appears.
* Never alias a scheme-dependent token with `var()` in `:root` (`--x: var(--ink)` is fixed at the root); the test checks that too.

### 2.3 Contrast (WCAG 2.2, computed from `tokens.css` by `src/styles/tokens.test.ts`, 79 pairs per scheme)

Text needs 4.5:1, graphics and focus rings 3:1.

| Pair | Need | Light | Dark |
|---|---|---|---|
| Text: `--ink` on `--bg` | 4.5:1 | 14.8 | 15.0 |
| Text: `--ink` on `--surface` | 4.5:1 | 16.0 | 13.0 |
| Secondary text: `--ink-2` on `--bg` | 4.5:1 | 7.9 | 9.1 |
| Caption, label: `--ink-3` on `--bg-2` | 4.5:1 | 5.1 | 5.9 |
| Mint text, links: `--accent-ink` on `--bg` | 4.5:1 | 5.8 | 12.0 |
| Mint text on tint: `--accent-ink` on `--accent-soft` | 4.5:1 | 5.4 | 8.2 |
| Text on mint fill: `--on-mint` on `--mint` | 4.5:1 | 9.9 | 9.9 |
| Button label: `--bg` on `--ink` | 4.5:1 | 14.8 | 15.0 |
| Error text: `--bad` on `--surface` | 4.5:1 | 6.3 | 7.1 |
| Mint graphics: `--accent` on `--bg-2` | 3:1 | 3.2 | 9.0 |
| Focus ring: `--focus` on `--surface` | 3:1 | 6.3 | 10.8 |
| Plan window: `--plan-window` on `--surface` | 3:1 | 5.5 | 7.4 |
| Series PV: `--series-pv` on `--surface` | 3:1 | 3.8 | 9.1 |
| Series grid: `--series-grid` on `--surface` | 3:1 | 4.1 | 5.5 |
| Series battery: `--series-battery` on `--surface` | 3:1 | 4.1 | 6.3 |
| Series heating: `--series-heat` on `--surface` | 3:1 | 4.5 | 6.1 |
| Label on zone day: `--ink` on `--zone-day` | 4.5:1 | 12.6 | 8.3 |
| Label on zone night: `--ink` on `--zone-night` | 4.5:1 | 11.5 | 9.5 |
| Label on zone terrace: `--ink` on `--zone-terrace` | 4.5:1 | 12.4 | 8.4 |
| Lit vs shaded surface: `--sun-lit` on `--sun-shade` | 4.5:1 | 6.4 | 10.4 |

Also tested: `--ink`, `--ink-2`, `--ink-3`, `--accent-ink`, `--good`, `--bad`, `--info`, `--plan-dim` on `--bg`, `--bg-2` and
`--surface`; `--accent`, `--focus` on all three; all `--series-*`, `--cat-*`, sun paths and map lines on their surface;
`--ink` and `--ink-2` on every zone.

The taste rule is a test as well: no colour token, material or look may be vivid with a hue between orange and amber
(`isOrangeish()` in `color.ts`).

## 3. Type

Geist Sans and Geist Mono from the `geist` package (self-hosted by `next/font/local`, no request to Google at run time;
glyph coverage of Czech and of `− – → ² ³ ° ≤ ×` was checked). Sans for everything, mono for measurements, numbers in tables,
small labels. Weights 400 (body), 500 (UI), 600 (headings). Headings use negative tracking
(`--tracking-tight`) and `text-wrap: balance`.

| Class / token | Size | Use |
|---|---|---|
| `.display`, `--fs-display` | 48-148 px fluid | the home page title |
| `.h1`, `--fs-2xl` | 40-96 px | page title (one per page) |
| `.h2`, `--fs-xl` | 32-64 px | section title |
| `.h3`, `--fs-lg` | 22-30 px | block title |
| `.lede`, `--fs-md` | 18-22 px | one-sentence introduction |
| body, `--fs-base` | 17 px | text |
| `.small`, `.note`, `--fs-sm` | 14 px | captions, hints |
| `.label`, `--fs-2xs` | 11 px mono caps | kickers, table heads |

## 4. Breakpoints

Desktop-first, `max-width`, one set. They are written out in `@media` (CSS cannot read variables), in `tokens.css`
(`--bp-*`, for readers of the file) and in `breakpoints.ts` (for JS); `tokens.test.ts` checks that all `@media` widths
in `src/styles` and `src/app` are one of these and that the three places agree.

| Name | max-width | Typical change |
|---|---|---|
| `sm` | 640 px | phones: single column, brand without sub-line |
| `md` | 900 px | tablets: two-column layouts collapse, footer 2 columns |
| `lg` | 1180 px | small laptops: the navigation collapses into the full-screen menu, tool side panels stack |

JS: `MQ.maxSm`, `MQ.maxMd`, `MQ.maxLg`, `MQ.minLg`, `MQ.coarse`, `MQ.reducedMotion` from `@/styles/breakpoints`; `useNarrow()` is
`MQ.maxSm`. Besides width: `(pointer: coarse)` for touch, `(max-height: ...)` for the menu on short screens.

## 5. Layout

* `.shell`: max 1440 px, side padding `--gutter` (20 px up to 56 px), clears the notch (`viewport-fit=cover`).
* `.section` / `.section-sm`: vertical rhythm `--section-y`. Space scale `--sp-1 ... --sp-10` (4 px base).
* `.panel`, `.panel-pad`, `.stack`, `.cols-2`, `.split-head`, `.index` (numbered list of pages), `.kicker`.
* `.tool-head` (via `ToolHead`): kicker with the page number, the `h1`, a lede, an optional aside; clears the fixed bar.
* Radii `--r-xs/sm/md/lg/pill`, shadows `--shadow-1/2/3`, z-index `--z-nav --z-menu --z-overlay --z-skip`, motion `--ease --dur-1/2/3`.

## 6. Components

`@/components/ui/controls` is a barrel: interactive controls are in `inputs.tsx` (a client module), figures and headings in
`display.tsx` (server-safe), so a page that only uses `ToolHead` ships no client code for it.

| Component | Notes |
|---|---|
| `Slider` | label, value text in the current language (`unit`, `format`), `aria-valuetext`; on touch a tap on the track jumps there |
| `Segmented` | single choice; measures its labels and goes row, then grid (4 as 2 x 2), then stack; labels never truncated |
| `Switch` | `role="switch"`, mint when on |
| `NumberField`, `NumInput` | typed text kept while editing, locale parsing (`12,5`, `12.5`, `1 234`), clamps on blur, arrow keys step, error text in the current language; `NumInput` is the bare input for tables |
| `Chips` | toggle chips with optional colour dot (`dot: "var(--zone-day)"`) |
| `Stat` | value, unit, caption; `accent` for mint |
| `ToolHead` | `n` (from `ROUTES[key].n`), `kicker`, `title`, `lede`, `aside` |
| `ThemeSwitch`, `LanguageSwitch` | in the bar and in the menu |
| `Nav` | tone follows what is under the bar (see below); full-screen menu with inert page, focus trap, Escape, scroll lock |
| `Footer` | server component; author, repository, fiction notice, sources and licences |
| `Reveal` | fades `.rv` blocks in on scroll; everything visible without JS |
| `NotFoundView`, `ErrorView`, `LoadingBar` | used by `not-found.tsx`, `error.tsx`, `loading.tsx` |

**Navigation tone.** A full-bleed dark block under the bar makes it light-on-dark: mark it `class="night"` or
`data-nav="dark"`. A dark block with its own top scrim (a photo hero) uses `data-nav="clear"` and the bar stays transparent.
The home page starts as `clear`, so its hero must carry `data-nav="clear"`.

## 7. Adding a page (the contract for page agents)

* The page lives in `src/app/[locale]/<key>/page.tsx`, **named after the route key** (`plan`, `plot`, `model`, `sun`,
  `energy`, `budget`, `gallery`; the home page is `src/app/[locale]/page.tsx`). Public URLs are localised in `src/lib/routes.ts`;
  `proxy.ts` rewrites `/pudorys` to `/cs/plan`. Never put a localised slug in a folder name.
* Keep `generateMetadata` (it calls `buildMetadata(locale, key)`, which reads `<key>.meta.title` and `<key>.meta.description`
  from your namespace). A page that lacks them fails type checking.
* Texts go into `src/lib/i18n/messages/<key>.ts` (`defineMessages({ cs, en })`; TypeScript fails when `en` lacks a key).
  Client components call `useT()`: wrap the page content in `<I18n locale={locale} namespaces={["plan"]}>` (server component,
  `@/lib/i18n/Provider`) so only that namespace is sent to the browser.
* Links: `routePath(locale, key)` from `@/lib/routes`, or `navLinks(locale, t)`. Numbers: `useFormat()` (client) or
  `getFormatter(locale)` (server): `num`, `area`, `length`, `degrees`, `percent`, `clock`, `money`, `range`, `list`.
  Never `toFixed` or `toLocaleString` on screen.
* Styles: new rules in `src/styles/pages/<key>.css`, imported by the page; tokens and layout classes only.
* 3D code belongs to `model` and `sun` only: `npm run check:bundles` fails otherwise.

## 8. i18n

Czech on root URLs, English under `/en`. `t("ns.path.to.key", { param })`: keys and `{placeholders}` are typed from the
Czech string; plural leaves are `{ one, few, other }` with `{count}` (Czech 1 / 2-4 / 5+, English 1 / other); numeric
parameters are formatted for the locale (pass a year as a string). Czech output goes through `nb()`: single-letter
prepositions, units, digit groups and dates get non-breaking spaces automatically, so write ordinary spaces in dictionaries.
Rich text: `rich(t("..."), { a: (c) => <a ...>{c}</a> })` for `<a>...</a>` inside a message.

## 9. `model/style.json` (`style/1`)

Used by the web (3D scene, legends, look pickers) and by Blender, so a render and the web agree.

* `palette`: `graphite`, `ivory`, `mint` (equal to the tokens; tested).
* `materials`: one entry per role (the GLB roles of `docs/ARCHITECTURE.md` plus `lawn`, `mulch`): `name {cs,en}`, `color`, `roughness`,
  optional `metallic`, `alpha`.
* `looks`: `facade` (4), `wood` (4), `roof` (3). Each option has `id`, `name {cs,en}`, optional `default: true` (exactly one per group;
  it equals the base materials), `set` (role to `{ color?, roughness? }`) and, for the "no timber" option, `substitute`
  (role to the role whose material is used instead). Code selects by array position or by the `default` flag and reads
  behaviour from `set` / `substitute`; it never branches on an `id`.
* No orange: tested with the same rule as the tokens.

## 10. Brand assets

`src/app/icon.svg` is the master (a long hip roof in graphite, a mint wall, on ivory; dark-scheme variant inside the SVG).
`scripts/make-brand-assets.sh` writes `apple-icon.png`, `favicon.ico`, `public/icons/{icon-192,icon-512,maskable-512}.png` and a
placeholder share image (`opengraph-image.jpg`, `twitter-image.jpg`, 1200 x 630, set in Geist). The final render replaces the
share image later. Needs `rsvg-convert` and ImageMagick.

## 11. What is checked

`npm test` runs: token structure and contrast (both schemes), breakpoints, no orange, `style.json`, dictionaries (same keys and
placeholders in both languages, plural forms), formatting and typography, routes and the proxy, a server render of the shell and
the placeholder pages in both languages, and `scripts/check-bundles.mjs` on fixtures. After `npm run build`, `npm run check:bundles`
verifies that three.js is only in the `model` and `sun` pages (both languages), that no page loads an external script, style or
font, and prints chunks and size per page.
