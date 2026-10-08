# Copy: voice, glossary and the rules of the dictionaries

How the site talks, in Czech and in English, and the conventions every string follows. The rules a machine can check are
enforced by `src/lib/i18n/copy.test.ts`; change this document and that test in the same commit.

## 1. Where text lives

| Text | Source | Notes |
|---|---|---|
| Interface, headings, ledes, captions, notes | `src/lib/i18n/messages/<namespace>.ts` (cs and en) | `defineMessages` makes the English mirror the Czech keys and placeholders |
| The house name | `model/house.json` `name` (through `SITE.house.name`) | never typed into a dictionary: write `{house}` |
| What this particular house is like | `model/house.json` `tagline`, `idea`, room, zone and outdoor names | facts about the plan live with the plan, so a re-plan cannot leave stale copy behind |
| Material, look, price-book line names | `model/style.json`, `model/pricebook.json` | same glossary |
| Picture titles and alt texts, share-image alt | `model/render.json` → media manifest | written against the final frames |
| Numbers | the model and the calc modules, through `{placeholders}` and `src/lib/i18n/format.ts` | a dictionary holds no number about the house |

Text in `src/lib/i18n` can change at any time. Text in `model/*.json` changes the content hash, so it is batched with the next
model rebuild (`model:build`, the models manifest and the media build), never landed on its own.

## 2. Voice

* **Short, concrete, confident.** Say what living in the house is like, then prove it with one number. "Celý dům bez jediného
  schodu", not "Půdorys odvozený z datového modelu".
* **A light poetic touch in headings, none in labels.** Every page title and home section title is a two-voice claim: a plain
  part and one accent phrase marked `<q>…</q>` ("Kam svítí slunce, `<q>`kdykoli v roce`</q>`"). One accent per heading.
* **The method once, the fiction four times at most.** The data model is named once, in the About section (`home.about.lede`).
  That the house is invented is said only in the hero note, the plot box (`plot.fiction`), the About line and the footer.
  No meta description, lede, legend or note repeats it.
* **One voice.** Status and progress strings speak in the first person singular ("Načítám…", "Počítám stíny…", "Připravuji
  soubor…"). Explanations are impersonal and active, with the thing as the subject ("Kontrola vychází z pravidel…", "Každých
  {step} minut se … vyšle paprsek"); no "my". Instructions address the reader with "vy" ("Klepněte", "Posuňte").
* **English is written, not translated.** Natural UK English (`<html lang="en-GB">`): colour, metre, storey, licence,
  "image" rather than "picture", sentence case everywhere. Contractions are fine in help text, not in tables.
* **Captions say what the picture shows.** No counts or measures in alt texts (they come from the model), and every alt is
  checked against the final frame.

## 3. Glossary

| Thing | Czech | English | Never |
|---|---|---|---|
| the turning timber louvre wall of the terrace | lamely terasy; in a sentence "natáčecí dřevěné lamely" | terrace louvres | lamelové stěny, zástěny, latě, slat screens, any "posun"/slide (the louvres only turn) |
| the louvre angle | natočení lamel; the closed stop is "zavřeno", 90° is "otevřeno" | louvre angle; closed, open | "rovnoběžně se sluncem" |
| exterior wall | obvodová stěna | external wall | obvodová zeď, exterior wall |
| inner load-bearing wall / partition | vnitřní nosná stěna / příčka | internal load-bearing wall / partition | nosná příčka |
| glazed sliding wall | posuvná prosklená stěna (short: prosklená stěna) | sliding glass wall | posuvná stěna, zasklená stěna |
| covered entrance | závětří | porch | kryté závětří, kryté stání |
| boundary | plot, brána (drive gate), branka (walk gate), příjezd (drive) | fence, gates, drive | živý plot (no hedges) |
| pool | bazén | pool | |
| living room | obývací pokoj ("obývák" only in a heading) | living room | obytný prostor, living space |
| roof | valbová střecha | hipped roof | hip roof |
| PV | fotovoltaika, panely na střeše; FVE only in dense tables | solar panels; PV only in dense tables | photovoltaics |
| blinds | venkovní žaluzie: vytažené, napůl, stažené | external blinds: up, half down, down | exterior blinds |
| floor area | užitná plocha (net area of the heated rooms, garage excluded) | floor area | podlahová plocha for two different numbers |
| built-up area | zastavěná plocha | footprint (plan), built-up area (plot) | |
| setback | odstup | setback | set-back |
| the sun | slunce, in lower case in running text; "Slunce" only as the page name | sun | Slunce mid-sentence |
| the project | portfoliový projekt | portfolio project | portfolio projekt, datově řízený, data-driven |
| a fly-around film | let kolem domu | fly-around | oblet kolem domu, flight around |

## 4. Czech typography

`t()` runs `nb()` (`format.ts`) on every string, so dictionaries are written with ordinary spaces. `nb()` glues:

* a number to its unit ("12,5 kWh", "240 m n. m.", "7,5 mil. Kč") and digit groups ("1 234 567");
* one-letter prepositions and conjunctions to the next word (Czech only);
* dates ("21. června", "20. 3. 2026"; English "20 Mar"), dimensions and scales ("23,5 × 12,3 m", "1 : 100").

**Never put a one-letter preposition (or ve, ze, ke) directly before a placeholder.** Its vocalised form depends on the
value: "v 5:10" but "ve 4:48", "z 8" but "ze 12". Times of day come with their preposition from `f.at(minutes)` /
`f.atHours(hours)` ("ve 21:03" / "at 21:03"), passed as `{atSunset}`. Counters are written "{n} / {total}". Otherwise rephrase.

## 5. Numbers and money

* Every number reaches the screen through `format.ts` (`getFormatter(locale)` or `useFormat()`): `num`, `unit`, `area`,
  `money`, `clock`, `at`, `range`, `estimate`.
* **Estimates** are rounded to three significant digits: `f.estimate(v)` / `formatEstimate(v, { sig: 3 })`, or
  `roundSig(v)` for a value that is animated or passed on.
* **Counted nouns** use the plurals in `common.count.*` (rooms, panels, doors, trees, shrubs, persons, bedrooms, years,
  hours, images, triangles, items): "{count} panely", never "{panels} panelů".
* **Money order is a language rule:** Czech "7,5 mil. Kč", "55 793 Kč/m²", English "CZK 7.5M", "CZK 55,793/m²". The
  templates are `budget.money.{million, millionRange, perM2, perM2Range}`. For a stat whose prefix and suffix are styled
  apart, fill the template with `VALUE_SLOT` and split it: `affixes(t("budget.money.million", { value: VALUE_SLOT }))`.

## 6. Keys

| Key | What | Rule |
|---|---|---|
| `<ns>.meta.title`, `<ns>.meta.description` | read by `buildMetadata()` | every route has them; descriptions may use `{house}` (home's may not: the web manifest reads it raw) |
| `home.meta.titleFull`, `common.meta.pageTitle` | the `<title>`: "{house} · studie přízemního domu", "{page} · {house}" | |
| `<ns>.title` | the h1 of a tool page | two-voice, exactly one `<q>` |
| `<ns>.lede` | the sentence beside the h1 | ≤ 220 characters, tells the reader what to do or find |
| `<ns>.teaser` | the line of the `NextTool` link that leads to this page | one short sentence |
| `common.method.title`, `common.next.{label, aria}` | the `MethodNote` label of every tool page; the `NextTool` kicker word and its landmark name (`{page}` = the next page's menu label) | one key for all pages, no per-page method headings |
| `nav.brandAria` | the label of the house-name link in the bar and on the 404 page | `{house}` only, never a spelled name |
| `nav.items.<key>.{label, desc}`, `nav.about` | menu, footer, home index | menu order comes from `routes.ts` |
| `common.shading.*` | the louvre and blind controls of the 3D tour and the Sun page | one set of words for both pages |
| `home.about.*` | "Jak dům vznikl": kicker, two-voice title, lede, five `steps` with `figure` plurals, stack, fiction line, source | |

**Rendering.** Headings with `<q>` go through `accent()` from `src/lib/i18n/rich.tsx`, which renders the phrase as
`<span class="accent">` (`--font-accent`, `docs/DESIGN.md`). It is the only rendering rule: `accentPhrase()` of the design
system (`@/components/ui/controls`, used by `ToolHead` and `NextTool`) delegates to it. Where a heading is reused as plain text
(`<title>`, `aria-label`, `alt`) use `plainText()` (`plainHeading()` is the same function). Other inline markup (`<a>`, `<sub>`, `<b>`) goes through `rich()` with the tags the component passes.

**Deprecated keys** stay until the copy pass that deletes them (they are marked `@deprecated` in the dictionaries); no new
code reads them.

**Length caps** apply only to what is read at a glance: hero lines ≤ 100 characters (hero alt ≤ 140), ledes ≤ 220, day and
orbit captions ≤ 150, other captions ≤ 220 (placeholders counted as eight characters). Method notes may be as long as they need.

## 7. What the copy test checks

`src/lib/i18n/copy.test.ts`, next to `translate.test.ts` (keys, placeholders and plural forms mirror each other) and
`format.test.ts`:

* the old name of the house appears in none of the scanned files (the scope widens to the whole repository at the merge);
* no dictionary spells the house name (it comes from `model/house.json`);
* no one-letter preposition, or ve, ze, ke, stands before a placeholder in Czech;
* the glossary: the "Never" column above, in both languages; the louvre strings never slide;
* the fiction is mentioned only in the four allowed places, the data model only in `home.about.lede`;
* every tool namespace has a two-voice `title`, a `lede` and a `teaser`; tags are known and closed; Czech and English mark the
  same accents;
* the length caps of section 6;
* no number about the house: digits only in names (3D, 404, standards, licences), conventions (±0,000, 1 : {scale}, 90°)
  and the typical ranges of the energy setting hints.
