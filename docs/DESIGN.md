# Dům pod ořechem: design system

Graphite ink on ivory, mint as light and signal only. Geist (sans and mono) speaks; one italic serif phrase per heading
(Instrument Serif, `--font-accent`) gives the headings a second voice. No orange, amber, honey or terracotta. Calm,
precise, architectural: a drawing-office feel with generous space and one disciplined 12-column grid. This document is
the contract for everyone who writes UI; `src/styles/tokens.css` is the single source of the values.

## 1. Where things live

```
src/styles/
  index.css            the only entry point (imported once by src/app/[locale]/layout.tsx)
  reset.css            Tailwind preflight in the `base` layer, nothing else from Tailwind
  tokens.css           every colour, size, space, radius, shadow, z-index, motion value and breakpoint
  base.css             document, type scale, the accent voice, links, focus, .sr-only, skip link, reduced motion
  layout.css           .shell .section .grid-12 .split-head .kicker .tool-head .index .method .next-tool .panel .stack
  components/          buttons, nav, footer, controls, data (stat, kv, table, bars, legend), states, motion (stage: 3D pages)
  pages/<page>.css     page-specific rules; imported by the page itself, never from index.css
  breakpoints.ts       the three breakpoints and ready-made media query strings for JS
  tokens.ts            readToken() / readTokens() / onSchemeChange(): tokens for canvas and three.js
  color.ts             contrast, Lab and ΔE, hue and token parsing (used by the tests)
src/fonts/index.ts     the font definitions (Geist Sans, Geist Mono, the accent face); imported by the root layouts only
src/components/        Nav, Footer, Reveal, LanguageSwitch, LoadingLine, ui/{controls,inputs,display,IntentLink,useWidth,ThemeSwitch,StateViews,numeric}
src/lib/i18n/          locales, dictionaries, t(), formatting (see section 8)
model/style.json       materials and looks for the web and Blender (section 9)
```

Rules:

* **No colour literals outside `tokens.css`.** No hex or `rgb()` in TSX or component CSS. A canvas or three.js scene asks
  for a token: `readToken("--zone-day")` returns the colour of the current scheme as `rgb(...)`.
* **No font size outside the scale.** Every `font-size` and `font` shorthand uses a `--fs-*` token (or a relative `em` inside a
  token-sized parent, such as the 0.36 em unit of a figure); the only literal is the 16 px of touch inputs. `style.test.ts`
  enforces it for the design system's files (page stylesheets join as their pages are rewritten).
* **No hand-written `-webkit-backdrop-filter` or `-webkit-mask`.** Lightning CSS (Next's minifier) adds the prefix itself;
  with a hand-written prefixed copy it keeps only the prefixed one and Chrome and Firefox lose the effect. `style.test.ts` fails
  on it.
* **No patch layers.** A component is styled in its own file; a later rule never "fixes" an earlier one. Page CSS may
  compose tokens and layout classes, not override components with `!important` (the only `!important` is the 16 px font
  of touch inputs, which must beat inline sizes).
* **One set of breakpoints** (section 4). Anything else fails `tokens.test.ts`.
* **Touch targets are 44 px** (`--touch`) on `(pointer: coarse)`: buttons, chips, segments, inputs, sliders, summaries, menu rows;
  the brand and `.link-arrow` grow an invisible hit area (`::before`) so their underline does not move.
* **Motion respects `prefers-reduced-motion`**: transitions collapse, revealed content stays visible.
* **Numbers and units never wrap** (no-break space, added by `nb()` and by `Stat`).

## 2. Colour

### 2.1 Palette

| Role | Light | Dark | Tokens |
|---|---|---|---|
| Page, recessed, card, raised | ivory `#f4f1e8`, `#eae6da`, `#fbfaf5`, white | graphite `#14171a`, `#1b1f23`, `#1f2428`, `#272d32` | `--bg --bg-2 --surface --surface-2` |
| Ink | `#1b1e21` `#454a50` `#596067` | `#eeeadf` `#bcb8ad` `#9a9a93` | `--ink --ink-2 --ink-3` |
| Rules, glass | graphite at 12 % and 22 %; ivory glass at 78 % | ivory at 12 % and 24 %; graphite glass at 72 % | `--rule --rule-2 --scrim` |
| Mint (light and signal) | graphics `#12906b`, text `#0a6a4c`, tint `#d4efe3` | graphics `#52d4a8`, text `#7fe6c2`, tint `#1d3a31` | `--accent --accent-ink --accent-soft --focus` |
| Solid mint (same in both) | `#5fd6ae` with `#0e1b16` on it | | `--mint --on-mint` |
| Controls | graphite `#1b1e21`, mint knob | mint `#5fd6ae`, dark knob | `--control-on --control-knob-on` |
| Night band (same in both) | `#0c0e10`, `#13161a`, `#171b1e`, glass at 62 % | | `--night-bg --night-bg-2 --night-surface --night-rule --night-scrim` |
| State | green, red, blue | lighter | `--good --bad --info` |

**Mint is light and signal, about 2-3 % of the pixels:** the travelled part of the sun arc, progress and loading lines, the
active-page dot, the link-underline sweep, the kicker hairline, focus, the selected room, the PV series, success pills
(`.pill.ok`) and one solid call to action per page (`.btn.mint`). Everything else, switches and sliders included, is graphite.

Domain tokens:

* **Zones** (floor plan fills, labels in `--ink`), each distinct in lightness or temperature (every pair ΔE ≥ 6, tested):
  day mint `#cfeee1`, night slate `#d6dce8`, service sage `#dae2d8`, circulation ivory `#eee8da`, garage grey `#c6cacd`
  (`--zone-day --zone-night --zone-service --zone-circulation --zone-garage`). The terrace has no tint (`--zone-terrace` is the
  surface): deck boards in `--plan-hatch` mark it. Plan drawing: `--plan-window` (a double thin line), `--plan-door` (solid thin
  leaf and swing), `--plan-dim`, `--plan-fixture`; walls are drawn with `var(--ink)`.
* **Data series**: one graphite ramp plus mint for PV, never a new hue (tested: every series is a neutral or a mint):
  `--series-load` `#2b3036`, `--series-heat` `#4e5a60`, `--series-export` `#7b8a86` (also hot water), `--series-pv` `#12906b`,
  `--series-battery` `#0a6a4c` (drawn hatched, `.hatch`), `--series-grid` `#868c93`, `--series-saving`; EV is `--ink-3` hatched.
  Categorical set `--cat-1 ... --cat-8` from the same ramp, mint first.
* **Sun**: `--sun-lit` (warm white) / `--sun-shade`, `--sun-disc` (white with an ink ring and a mint halo, same in both schemes),
  paths `--sun-summer` (graphite), `--sun-equinox` (mint), `--sun-winter` (grey, dashed); `--stage-bg` behind a 3D scene until it paints.
* **Sky** (same in both schemes: a sky follows the sun, not the page): `--sky-day-top` `#a3c8ea`, `--sky-day-horizon` `#e6eff4`,
  `--sky-low-horizon` `#eef0ea`, `--sky-dusk-top` `#3a5684`, `--sky-dusk-horizon` `#e6d3da`, `--sky-night-top` `#0b1422`,
  `--sky-night-horizon` `#22324a`, `--sky-glow` `#f6ead6`. The 3D viewer blends them by sun altitude. `--sky-top` / `--sky-bottom`
  are deprecated aliases of the day pair, kept until the viewer and the sun chart read the keys.
* **Plot map**: `--map-plot --map-plot-line --map-setback --map-house --map-roof --map-neighbour --map-road --map-paving --map-lawn --map-tree --map-contour`.
* **On photos and renders** (same in both schemes): `--on-media --media-scrim --media-scrim-lo --media-shadow`.

### 2.2 Schemes

The scheme follows the system (`prefers-color-scheme`) and can be forced with `<html data-theme="light|dark">`. The theme
switch (`ui/ThemeSwitch.tsx`) cycles system, light, dark and stores a forced choice in `localStorage` (every access in
`try/catch`); `THEME_SCRIPT` in `<head>` applies it before first paint, so nothing flashes. Dark mode gets the same care:
every pair of the contrast table is tested in both schemes, and the night band stays a step deeper than the dark page.

* `.night`: the night room, dark in both schemes (the gallery band, the open menu): dark ink and mint, and the surfaces sink to
  `--night-*`. The bar over it switches to the night glass (`--night-scrim`), over the open menu to `--night-bg`, so there is no seam.
* `.scheme-dark`: only the dark tokens for a subtree (the bar over any dark block carries it).
* The dark values are written twice in `tokens.css` (forced block and media query). `tokens.test.ts` keeps both identical, and
  keeps the scheme-independent tokens (mint, media, night band, sky, sun disc) out of both.
* Tokens are plain values per scheme, **not** `light-dark()`: Lightning CSS rewrites `light-dark()` into toggles that are
  resolved at `:root` and would ignore `.night`. The test fails if `light-dark(` appears.
* Never alias a scheme-dependent token with `var()` in `:root` (`--x: var(--ink)` is fixed at the root); the test checks that too.

### 2.3 Contrast (WCAG 2.2, computed from `tokens.css` by `src/styles/tokens.test.ts`)

Text needs 4.5:1, graphics, chart series and focus rings 3:1. Tested in both schemes.

| Pair | Need | Light | Dark |
|---|---|---|---|
| Text: `--ink` on `--bg` | 4.5:1 | 14.8 | 15.0 |
| Secondary text, the accent phrase: `--ink-2` on `--bg` | 4.5:1 | 7.9 | 9.1 |
| Caption, label: `--ink-3` on `--bg-2` | 4.5:1 | 5.1 | 5.9 |
| Mint text: `--accent-ink` on `--bg` | 4.5:1 | 5.8 | 12.0 |
| Text on mint fill: `--on-mint` on `--mint` | 4.5:1 | 9.9 | 9.9 |
| Button label: `--bg` on `--ink` | 4.5:1 | 14.8 | 15.0 |
| Control on: `--control-on` on `--surface` | 3:1 | 16.0 | 8.7 |
| Mint graphics: `--accent` on `--bg-2` | 3:1 | 3.2 | 9.0 |
| Series PV: `--series-pv` on `--surface` | 3:1 | 3.8 | 9.1 |
| Series export, winter path: `--series-export` on `--surface` | 3:1 | 3.5 | 5.3 |
| Series grid: `--series-grid` on `--surface` | 3:1 | 3.3 | 3.7 |
| Plan door: `--plan-door` on `--bg-2` | 3:1 | 3.3 | 4.4 |
| Label on zone garage: `--ink-2` on `--zone-garage` | 4.5:1 | 5.4 | 5.5 |
| Night band: `--ink-3` on `--night-bg` | 4.5:1 | 6.8 | 6.8 |

Also tested: `--ink`, `--ink-2`, `--ink-3`, `--accent-ink`, `--good`, `--bad`, `--info`, `--plan-dim` on `--bg`, `--bg-2` and
`--surface`; `--accent`, `--focus`, `--plan-window`, `--plan-door`, `--control-on` on all three; all `--series-*` on `--surface`
and `--surface-2`; `--cat-*`, sun paths and map lines on their surface; `--ink` and `--ink-2` on every zone; ink, mint and focus
on the three night surfaces.

The taste rule is a test as well: no colour token, material or look may be vivid with a hue between orange and amber
(`isOrangeish()` in `color.ts`). Warm tones stay pale: sky glow `#f6ead6`, deck `#c8bea8`, wood `#cfc2a4`.

## 3. Type

Geist Sans and Geist Mono come from the `geist` package (self-hosted). The accent face, Instrument Serif Italic (SIL OFL), is
loaded by `next/font/google` (latin and latin-ext for Czech, weight 400, italic only, `display: swap`); next/font downloads it at
build time and serves it from our own origin, so the browser never contacts Google. All three are defined once in
`src/fonts/index.ts` (`fontVariables` on `<html>`), mapped to `--font-sans`, `--font-mono` and `--font-accent`. Switching the
accent (for example to Geist Italic 300) is a change in that file only. `font-synthesis: none` on the body: a missing face is
caught in review instead of being faked.

| Role | Class / token | Size | Spec |
|---|---|---|---|
| Display (the house name on Home) | `.display`, `--fs-display` | 52-152 px, at most 16svh | Geist 600, two stacked lines, line height .9, tracking −0.058em |
| H1 claim (one per page) | `.h1`, `--fs-2xl` | 40-96 px | Geist 600, line height .95, −0.05em, a two-voice statement |
| H2 (section) | `.h2`, `--fs-xl` | 32-64 px | Geist 600, line height 1, −0.044em |
| Page index rows, next tool, menu | `--fs-index` | 26-48 px | Geist 600 |
| H3 (card title) | `.h3`, `--fs-lg` | 22-30 px | Geist 600 |
| Hero figure (Home) | `--fs-figure` | 40-64 px | Geist 300, proportional figures |
| Figure (tool pages) | `.stat .v`, `--fs-stat` | 30-46 px | Geist 300; unit in sans at 0.36 em in `--ink-3`, joined by a no-break space |
| Lede | `.lede`, `--fs-md` | 18-22 px | `--ink-2`, at most 46ch (40ch in the right column of a tool head) |
| Body | `--fs-base`, `.body` | 17 px / 1.55 | at most 62ch (`--measure`) |
| UI: controls, tables, buttons | `--fs-ui` | 15 px | |
| Notes, hints, legends, nav links | `.note`, `.small`, `--fs-sm` | 14 px | |
| Mono caption | `--fs-xs` | 12 px | |
| Label, kicker | `.label`, `.kicker`, `--fs-label` | 11.5 px | Geist Mono 500, uppercase, +0.12em, `--ink-3`; a kicker has a 24 px mint hairline in front |
| Chart axes, table heads | `--fs-2xs` | 11 px | Geist Mono |
| Wordmark (footer) | `--fs-wordmark` | 48-168 px | the house name, first word in Geist, the rest in the accent |

**The heading rule (two voices).** A statement heading (display, h1 claim, h2) may carry **one** accent phrase, written as
`<q>…</q>` in the dictionary: `"Kolik dům stojí, <q>položku po položce</q>"`. It becomes `<span class="accent">` through one
rendering rule, `accent()` in `src/lib/i18n/rich.tsx`; `accentPhrase()` (`ui/display.tsx`) is the same rule for components (it
passes anything that is not a string through unchanged). `ToolHead` and `NextTool` do it for you, and a literal `<q>` inside a
heading is styled the same (no quotation marks). The accent is Instrument Serif Italic 400, tracking −0.02em, in `--ink-2` (over a render it keeps the light
ink). Never in body text, UI, labels or numbers. `plainHeading()` (= `plainText()` of `rich.tsx`) strips the markup for aria labels
and metadata. One h1 per page
(the claim), one h2 per secondary section, card titles at `--fs-lg`, panel group labels in `.label`.

**Figures.** `Stat` takes `value`, `unit` (spaced: "166,2 m²"), `suffix` (attached: "/m²", "M"), `prefix` ("CZK 11.74M") and
`label`; the unit is small sans with its no-break space inside, so copy and screen readers get "23,5 m". Digits are proportional
at rest; CountUp marks its span `data-counting` while it counts, which switches to tabular digits so nothing jitters.
`accent` marks the one figure that matters (mint). Table heads are uppercase mono; a unit in a head goes in `<span class="u">`
so it keeps its case (m², h).

## 4. Breakpoints

Desktop-first, `max-width`, one set. They are written out in `@media` (CSS cannot read variables), in `tokens.css`
(`--bp-*`, for readers of the file) and in `breakpoints.ts` (for JS); `tokens.test.ts` checks that all `@media` widths
in `src/styles` and `src/app` are one of these and that the three places agree.

| Name | max-width | Typical change |
|---|---|---|
| `sm` | 640 px | phones: single column, index rows stack their description, footer one column (pages still in two) |
| `md` | 900 px | tablets: split heads stack, footer: about on its own row, then pages and project |
| `lg` | 1180 px | small laptops: the navigation collapses into the full-screen menu, the tool head's lede moves under the h1, tool side panels stack |

JS: `MQ.maxSm`, `MQ.maxMd`, `MQ.maxLg`, `MQ.minLg`, `MQ.coarse`, `MQ.reducedMotion` from `@/styles/breakpoints`; `useNarrow()` is
`MQ.maxSm`. Besides width: `(pointer: coarse)` for touch, `(max-height: ...)` for the menu on short screens.

## 5. Layout

* `.shell`: max 1440 px, side padding `--gutter` (20 px up to 56 px), clears the notch (`viewport-fit=cover`).
* **One grid**: 12 columns, gap `--grid-gap` (`.grid-12`). Secondary blocks start at column 8: the lede of a `.split-head`
  (heading on columns 1-7), the descriptions of an `.index`, the teaser of `NextTool`. The tool head puts its lede on columns 9-12.
* `.section` / `.section-sm`: vertical rhythm `--section-y` (96-168 px) and `--section-y-sm`. Space scale `--sp-1 ... --sp-10` (4 px base).
* `.kicker`: the 24 px mint hairline, an optional number and a label: "— 03 — Pozemek" (the dashes are drawn by CSS; the markup is
  `<span class="n">03</span><span class="kicker-label">Pozemek</span>`, or a `.label` span on Home).
* `.panel`, `.panel-pad`, `.stack`, `.cols-2`, `.split-head`, `.index` (numbered list of pages with the long thin arrow `.arrow`).
* Radii `--r-xs/sm/md/lg/pill`, shadows `--shadow-1/2/3`, z-index `--z-nav --z-menu --z-overlay --z-skip`, motion `--ease --ease-out --dur-1/2/3 --dur-reveal`.

**Every tool page uses one frame**, top to bottom: `ToolHead` (kicker "0N — Page", the two-voice h1 claim, the lede in the
right column), a four-figure strip (`.stats-4` of `Stat`), the instrument (a stage or a drawing plus a 360 px rail), result
cards, `MethodNote`, `NextTool`, then the footer.

**Motion** (`components/motion.css`, `Reveal.tsx`). Blocks with `.rv` fade and rise as they scroll in; `.h1`/`.h2`/`.display`
with `.rv` wipe in from the top; `.rv-media` opens from a slightly inset frame while its picture settles from a small zoom;
`.stats-4.rv` (or `.stagger.rv`) brings its items in one after another. A block already on screen when the page mounts never
animates (`.in` without `.play`). Every entrance is a transition or a keyframe animation with fill `backwards`, so nothing
(no clip-path, no transform) stays in effect afterwards. The tool head enters on load; its h1 and lede only move (no fade), so the
largest paint is not delayed. Reduced motion: everything static and visible.

## 6. Components

`@/components/ui/controls` is a barrel: interactive controls are in `inputs.tsx` (a client module), figures, headings and the
closing blocks in `display.tsx` (server-safe), so a page that only uses `ToolHead` ships no client code for it.

| Component | Notes |
|---|---|
| `Slider` | label, value text in the current language (`unit`, `format`), `aria-valuetext`; 2 px graphite track, 18 px thumb with an ink ring; on touch a tap on the track jumps there |
| `Segmented` | one choice from up to six; measures its labels and goes row, then grid (4 as 2 x 2), then stack; labels never truncated |
| `Switch` | `role="switch"`; graphite track when on, mint knob (dark scheme: mint track, dark knob) |
| `NumberField`, `NumInput` | typed text kept while editing, locale parsing (`12,5`, `12.5`, `1 234`), clamps on blur, arrow keys step, error text in the current language; `NumInput` is the bare input for tables |
| `Chips` | independent toggles (layers) with an optional colour dot (`dot: "var(--zone-day)"`) |
| `Stat` | `value`, `unit`, `suffix`, `prefix`, `label`; `accent` for the one mint figure (section 3) |
| `ToolHead` | `n` (from `ROUTES[key].n`), `kicker` (the page label), `title` (a string with `<q>` becomes two voices), `lede`, `aside` (both in the right column) |
| `MethodNote` | `title` (`t("common.method.title")`, the label "JAK SE TO POČÍTÁ"), `children`, `open?`, `id?`: a full-width disclosure, the last block of every tool page; works without JS |
| `NextTool` | `from` (the route key), `t` (server translator): the next page in menu order (`ROUTE_KEYS`; after the last tool comes Home) with its `<key>.title` and `<key>.teaser`; kicker word `common.next.label`, landmark name `common.next.aria`. Optional `title`: the next title ready-made when it needs a value (`plot.title` takes `{area}`, so the Plan page passes `title={t("plot.title", { area })}`); without it such a title falls back to the menu label |
| `accentPhrase`, `plainHeading` | the two-voice heading helpers (section 3; they delegate to `accent()` / `plainText()` of `rich.tsx`) |
| `IntentLink` | a `<Link>` that prefetches a heavy route (`ROUTES[key].heavy`: the 3D pages) on intent (pointer, focus, touch) instead of in view, and carries the loading-line marker; light routes keep Next's default prefetch |
| `useWidth`, `useSize` (`ui/useWidth`) | measured size of an element: draw charts at their real width with fixed 11 px text |
| `ThemeSwitch`, `LanguageSwitch` | quiet utilities behind a hairline in the bar, and in the menu |
| `Nav` | the brand is the house name (`houseName` prop from the layout, which reads the model on the server; no client file imports the model or site-config); tone follows what is under the bar (below); glass with the unprefixed `backdrop-filter`; mint dot on the current page; slides away on Home after 1.2 screens while reading down; the loading line (`LoadingLine.tsx`, `useLinkStatus`) under it; full-screen night menu with every tool, Home and "About", inert page, focus trap, Escape, scroll lock, 44 px rows |
| `Footer` | server component: about, pages (two columns), project and sources on the 12-column grid; one line with the copyright and the single disclaimer; the house name as a two-voice wordmark |
| `Reveal` | reveals `.rv` and `.rv-media` on scroll (section 5) |
| `NotFoundView`, `ErrorView` | used by `[locale]/not-found.tsx` (a `notFound()` inside a real page) and `error.tsx`; unknown addresses get the static `app/global-not-found.tsx`, which renders the same message with plain links. Route loading is the loading line under the bar (no `loading.tsx`) |

**Control rule.** Segmented = one choice from up to six (also camera views, gallery filters, day types, looks: with `data-fit`
it wraps instead of overflowing). Chips = independent toggles only (layers), never a single choice. A slider for a continuous value
with a visible value text. Controls are graphite; mint marks a result, not a control.

**Method rule.** "How it is calculated" is always a `MethodNote` at the end of the page, never a card, a loose heading or a
note squeezed under a table. Disclaimers about the numbers live in it (and in the footer), not under the page title.

**Navigation tone.** A full-bleed dark block under the bar makes it light-on-dark: mark it `class="night"` or
`data-nav="dark"`. A dark block with its own top scrim (a photo hero) uses `data-nav="clear"`: the bar stays transparent with a
soft text shadow. The home page starts as `clear`, so its hero must carry `data-nav="clear"`. Light text over a render goes in an
element with `.on-media` (or inside `[data-nav="clear"]`) so an accent phrase keeps the light ink.

**Prefetch.** The bar is always in view and links every page, so Next would prefetch all of them. Light pages keep that (it
makes navigation instant; the console notes about preloaded page CSS are harmless). Heavy pages are prefetched on intent only.

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
* Styles: new rules in `src/styles/pages/<key>.css`, imported by the page; tokens and layout classes only, every font size a
  `--fs-*` token (then remove the file from `PENDING` in `src/styles/style.test.ts`).
* The frame: `ToolHead` with `kicker={t("nav.items.<key>.label")}`, `title={t("<key>.title")}` (two voices), `lede`; end with
  `<MethodNote title={t("common.method.title")}>` and `<NextTool from="<key>" t={t} />`.
* 3D code belongs to `model` and `sun` only: `npm run check:bundles` fails otherwise.

## 8. i18n

Czech on root URLs, English under `/en`. `t("ns.path.to.key", { param })`: keys and `{placeholders}` are typed from the
Czech string; plural leaves are `{ one, few, other }` with `{count}` (Czech 1 / 2-4 / 5+, English 1 / other); numeric
parameters are formatted for the locale (pass a year as a string). Czech output goes through `nb()`: single-letter
prepositions, units, digit groups and dates get non-breaking spaces automatically, so write ordinary spaces in dictionaries.
Rich text: `rich(t("..."), { a: (c) => <a ...>{c}</a> })` for `<a>...</a>` inside a message; a heading's `<q>` goes through
`accent()` / `accentPhrase()` (section 3). Voice, glossary, Czech typography rules and key conventions (two-voice titles, ledes,
teasers, deprecated keys) are in `docs/COPY.md`.

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
`scripts/make-brand-assets.sh` writes `apple-icon.png`, `favicon.ico` and `public/icons/{icon-192,icon-512,maskable-512}.png`
(icons only). The share images (`opengraph-image.jpg`, `twitter-image.jpg`) are renders from the media pipeline. Needs
`rsvg-convert` and ImageMagick.

## 11. What is checked

`npm test` runs: token structure and contrast (both schemes and the night band), zone separation, the graphite chart ramp,
breakpoints, no orange, `style.json`, the stylesheet rules (no hand-written prefixes, the type scale), dictionaries (same keys and
placeholders in both languages, plural forms), formatting and typography, routes and the proxy, a server render of the shell and
the placeholder pages in both languages, and `scripts/check-bundles.mjs` on fixtures. After `npm run build`, `npm run check:bundles`
verifies that three.js is only in the `model` and `sun` pages (both languages), that no page loads an external script, style or
font, and prints chunks and size per page.
