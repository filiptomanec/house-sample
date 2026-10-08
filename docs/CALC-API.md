# Calculation modules (`src/lib/calc`)

Pure TypeScript that turns the data model into the numbers on the Sun, Energy and Budget pages, the 3D PV layer and the
printable model. This document is the contract between the modules and the pages written against them. Every file below is
implemented and tested; when a signature changes, change this document in the same commit.

| File | Content | Used by |
|---|---|---|
| `sun.ts` | solar position, time-zone arithmetic, sunrise and sunset, arcs, the roof-overhang shadow, the analytic sun-hours oracle | Sun, Energy, Model (sun light), Home |
| `roofLayout.ts` | roof planes with stable keys, panel layout, the visitor's PV selection | Energy, Model (3D panels), Home, Budget |
| `uvalue.ts` | U-values (EN ISO 6946), floor on the ground (EN ISO 13370), what-if helpers | Energy, Floor plan (assembly cards) |
| `energy.ts`, `energySchema.ts` | the energy balance; the zod schema of `model/assumptions.json` (`AssumptionsSchema`, `parseAssumptions`), kept out of the browser bundle | Energy, Home (KPIs) |
| `budget.ts` | barrel that re-exports the four budget files below | server code, scripts, tests |
| `budgetCore.ts` | `QUANTITY_DEFS`, PV quantities, material take-off, the price book type and its memoised default | Budget (client), Home |
| `budgetSchema.ts` | the zod schema of `model/pricebook.json` (`PricebookSchema`, `parsePricebook`); server, tests and scripts only | tests, scripts |
| `budgetCompute.ts` | settings, `computeBudget`, CSV | Budget (client) |
| `budgetQuantities.ts` | `deriveQuantities` (needs the plot model, so it runs on the server) | Budget (server), Home |
| `printModel.ts`, `triangulate.ts` | the printable mesh and the binary STL; ear-clipping triangulation with holes | Model page (STL export) |
| `storageKeys.ts` | the one place that names `localStorage` entries | every page that remembers something |
| `model/assumptions.json`, `model/pricebook.json` | household, tariffs and profiles; unit prices (both `status: "reviewed"`) | `energy.ts`, `budget*.ts` |

```
model/house.json ──► src/lib/model (kernel) ──► house, derived, metrics ─┐
model/site.json  ──► src/lib/model/site ──────► Site (terrain, plot) ───┤
src/lib/data/pvgis.json (climate, PVGIS) ───────────────────────────────┤
model/assumptions.json ──► energySchema.AssumptionsSchema ─────────────┤
model/pricebook.json   ──► budgetSchema.PricebookSchema ────────────────┤
                                                                        ▼
  sun.ts ◄── energy.ts ──► roofLayout.ts ──► uvalue.ts          budget*.ts (deriveQuantities → computeBudget → toCsv)
    │            │                │                                    printModel.ts (buildPrintMesh → buildStl)
    ▼            ▼                ▼
  Sun page   Energy page   Model page (3D panels), Home, Budget      storageKeys.ts: what the visitor chose, per browser
```

Import the model like this (specific files, so a calc module never pulls the validator into a page bundle):

```ts
import { house, derived, metrics } from "@/lib/model/instance";          // the shared parsed instance
import type { Derived, House, Metrics } from "@/lib/model/types";        // types are free
import { layoutPv, type PvSpec } from "@/lib/model/pv";                  // kernel pieces by file, not by "@/lib/model"
import { createSite } from "@/lib/model/site";                           // the plot; siteJson from "@model/site.json"
```

## 1. Conventions (all modules)

**Units.** Metres, square metres, cubic metres; degrees (angles, latitude, pitch); watts (W, W/K for heat transfer coefficients,
W/(m² K) for U) and kilowatts only where a name says `Kw`; energy in **kWh**; temperature in °C; money in **CZK**
(Energy prices are what the household pays, VAT included; the price book is without VAT and says so). Hourly series are kWh in
that hour (numerically the mean kW). Names carry the unit when it is not obvious (`indoorTempC`, `pvKwh`, `hV`).

**Time.** Months are **0-based** everywhere (`0` = January, like `Date` and `src/lib/calendar.ts`); a `CalendarDate` is
`{year, month (0-based), day}`. Clock times are decimal wall-clock hours (`7.5` = 7:30) in the time zone of the place; hourly
arrays are indexed by the wall-clock hour (`h` covers `h:00` to `h+1:00`). The typical year has 365 days
(`DAYS_IN_MONTH`); the climate data are a typical year too. **No function reads the clock** (`Date.now`, `new Date()` without an
argument) or a random number; pages must not call `new Date()` during render either (server and client would disagree): pick
a deterministic default date such as `keyDays(...).equinox` and let the visitor move it.

**Orientation.** Azimuths are **true** (clockwise from true north) unless a name says `house`; `house` azimuth 0 = house +y.
`true = (house + location.houseAxisBearingDeg) mod 360`. Kernel fields `azimuthTrue` already include the bearing. PVGIS data are
keyed by the **house-frame** direction `N|E|S|W` (`Dir`), not by compass direction (`docs/ENERGY-DATA.md`). Vectors are
`[east, north, up]` in the house frame; three.js code converts `(x, y, z) -> (x, z, -y)`.

**No text, only keys.** Calc modules never import i18n and never return a sentence. They return numbers and **keys** (string
unions such as `EnvelopeKind`, `DayTypeKey`, `EnergyWarningKey`, `PaybackStatus`, `UnitKey`) and the bilingual `LocalizedText`
objects that exist in the data (price book names, model names). The page translates keys through its dictionary
(`energy.envelope.wall`, `energy.dayType.clear`, `budget.units.m2`) and formats numbers through `src/lib/i18n/format.ts`.
Czech `LocalizedText` from JSON goes through `nb()` on screen like any other Czech string.

**Purity and determinism.** No DOM, no React, no `three`, no I/O, no module state that changes results (memoising a pure result
is fine). Same inputs, same outputs, bit for bit, in Node, in the browser, in a worker. Inputs are never mutated; results are
fresh objects that callers may keep. A shared `derived` must not be mutated.

**Nothing about the house in code.** Every number comes from the model (`house`, `derived`, `metrics`, `site`), the climate file, `model/assumptions.json` or
`model/pricebook.json`. Physical and normative constants (the heat capacity of air, `0.457` in EN ISO 13370, `4.186`) are named
constants at the top of the module with the standard quoted. **Never branch on an id** (`R04`, `W02`, `T1`, a layer id, a price
line id): use `type`, `kind`, `role`, `side`, `zone`, array loops, or a key from the data. Ids are allowed as map keys of
user edits (budget overrides) and as React keys, nothing else.

**Validation and bad values.** There are three kinds of input and three behaviours:

| Input | Examples | Behaviour |
|---|---|---|
| Typed or stored by a visitor (untrusted) | slider values, saved JSON, a half-typed number | `sanitize*` functions turn anything into complete valid values: missing/non-finite numbers take the default, numbers are clamped to the range from the data files, unknown ids/keys are dropped. They never throw and never return `NaN`. `compute*` functions call them first, so garbage cannot leak into a result. |
| Data files | `assumptions.json`, `pricebook.json`, `pvgis.json` | Parsed with a zod schema when the default context / price book is built (`parseAssumptions`, `parsePricebook`); a bad file throws `ZodError` with the path. This is a development-time error, the tests catch it. |
| Programmer errors | `NaN` time, `abs(lat) > 90`, a layer with no conductivity, unknown layer id, 30 February | `RangeError` (or `TypeError`) with a message that names the argument. |

Degenerate but valid situations (no panels, no heating demand, zero area, polar night) return the natural limit (`0`, `null`
for "undefined", `status: "none"`), **never `NaN` or `Infinity`**. A `null` always means "not defined" and the type says so.
Results outside a documented range of validity (`sunPosition` before 1800 or after 2200) are still numbers; the doc comment
states the accuracy loss.

**Constants.** Where a value lives, in order: the house model (geometry, assemblies, windows, equipment, shading, location) →
`pvgis.json` (climate) → `assumptions.json` (household, tariffs, profiles, day types, battery, efficiency curve shape) →
`pricebook.json` (prices, VAT, reserve) → named constant in the module (physics and standards). A value that two pages show
must have one source: the PV system price per kWp is in the price book and in `assumptions.json` (with VAT) and a test keeps
them equal (section 11).

**Performance.** `computeEnergy` runs in a few milliseconds and is called on every slider move, so it must not re-derive the
house (`derive` is a kernel call; use the shared instance), must memoise the PV layout capacity per plane inside the
context (the layout of a plane does not depend on the inputs), and must allocate arrays, not objects per hour. Anything that
takes more than about 5 ms belongs behind `useDeferredValue` in the page, not in a web worker. `buildPrintMesh` may take
longer (a button press).

## 2. Data files

### 2.1 `src/lib/data/pvgis.json` (`pvgis/1`)

Typed as `ClimateData` in `energy.ts`. Four facings in the **house frame** at the roof pitch; monthly kWh per kWp, hourly
irradiance profile of a typical day per month in **UTC**, hourly temperature in UTC, and monthly irradiation of vertical planes.
`checkClimate(house, derived, climate)` reports `pitch`, `bearing` or `location` when the file does not fit the model (the
energy result then carries the warning `climateMismatch`). To get local-time profiles shift by the UTC offset; in the months
of the daylight-saving change use `monthOffsetMix` (section 4) as a weighted mixture instead of guessing winter or summer.

### 2.2 `model/assumptions.json` (`assumptions/1`)

Schema: `AssumptionsSchema` in `energySchema.ts` (zod; the browser uses the JSON as it is, a test pins that parsing changes nothing). Every key is documented there; summary:

| Section | Content |
|---|---|
| `meta` | `status` (`starter` or `reviewed`), region, currency, price year, `sources[]` (shown in "what is calculated") |
| `climate` | `referenceYear` (calendar year for time-zone rules), `designOutdoorC` (EN 12831) |
| `inputs` | range (`min`, `max`, `step`) and `default` of each adjustable number: `indoorTempC persons dhwLitresPerPersonDay appliancesKwhYear evKmYear n50 scop scopDhw priceBuy priceSell pvPricePerKwp batteryPricePerKwh subsidy`; `scop`/`scopDhw` have no default (they come from `house.equipment.heating`); `flags` = defaults of the two switches |
| `thermal` | thermal-bridge allowance `ΔU`, internal heat capacity, `τ0` of the utilisation factor, heat capacity of air, solar correction, direct share of the vertical irradiation, `unheatedB` (b-factor by room type, e.g. the garage) |
| `ground` | soil conductivity, periodic penetration depth, EN 12831 `f_g1` |
| `ventilation` | shielding coefficient `e`, fresh air per person, minimum air change rate |
| `gains` | metabolic heat per person, share of household electricity that becomes heat |
| `ev` | consumption per km and charging loss share |
| `heating` | distribution loss share, shape of the COP curve (approach temperatures) |
| `dhw` | cold-water temperature, loss share, hours of heating (daytime / default) |
| `profiles` | household load shape (24 values), EV charging hours, base share of the heating profile |
| `pv` | `dayTypes[4]` (`clear partly overcast dark`: production factor and weight; weights sum to 1, weighted mean factor is 1), `inverterClipping` |
| `battery` | usable share and round-trip efficiency (capacity and power come from the model's `equipment.battery.options`) |
| `economy` | payback cap in years; `fixedChargesPerYear`: fixed charges of the connection (CZK with VAT), added to both annual costs |

`meta.status` is `reviewed`: every value is checked against a source listed in `meta.sources`. `docs/ENERGY-ASSUMPTIONS.md` records the
source of each number and the places where the calculation departs from this document.

### 2.3 `model/pricebook.json` (`pricebook/1`)

Schema: `PricebookSchema` in `budgetSchema.ts` (re-exported by `budget.ts`). Prices are without VAT, in CZK.

| Key | Content |
|---|---|
| `meta` | as above |
| `vat` | `classes` (`{residential: 0.12, standard: 0.21}`: shares) and `default` |
| `reserve` | `default`, `min`, `max`, `step` of the contingency share |
| `siteOverhead` | `null` or `{id, name, groupId, share, roundTo}`: site facilities and ancillary costs as a share of the construction work, rounded; a computed line of the group `groupId` (which must not be optional) |
| `groups[]` | `{id, name, note?, optional, defaultOn, vat, siteOverheadBasis, lines[]}`; optional groups can be switched off and are not part of the house price or the price per m² |
| `benchmark` | optional `{perM2Low, perM2High}`: a typical range of the finished house price per m² of heated floor, CZK with VAT. It is an independent check, not derived from the lines; `estimateBand(book, floorAreaHeated)` turns it into an orientation band (`null` when absent) |
| `lines[]` | `{id, name, unit, quantity, price, waste?, note?}`; `quantity` is `{ref: QuantityKey, factor?, offset?}` (quantity = `ref × factor + offset`, factor 1 and offset 0 by default) or `{value}`; `waste` (0 to 1) is the allowance for offcuts and breakage that the unit price already contains: it decides which lines appear on the "how much material" cards and never changes an amount |

The schema checks: unique ids across groups, lines and the overhead; known VAT classes; every `ref` a key of `QUANTITY_DEFS`;
non-optional groups are on; the overhead group exists and is not optional; `benchmark.perM2Low < perM2High`. Test: every line's `unit` equals the unit of its `ref`.

## 3. Using the modules from a page

Server components may call anything that does not read storage; the modules are cheap enough to run during render for fixed
inputs (Home KPIs). Client components read storage **after mount** and keep the first render equal to the server's.

```tsx
// Sun page: the place and the date, nothing about the site in the component
const place = placeOf(house);
const day = sunDay(place, date);                       // date: state, default keyDays(place, year).equinox (fixed year from the data)
const sun = sunPosition(localToUtc(place.tz, date, hours), place);
const dir = sunDirection(sun.azimuth, sun.altitude, house.location.houseAxisBearingDeg);   // for the light and the ray cast

// Energy page
const ctx = defaultEnergyContext();                    // module-level, memoised
const [inputs, setInputs] = useState(() => defaultInputs(ctx));
useEffect(() => {                                      // after mount only
  const saved = readStored("energy", { parse: (d) => sanitizeInputs((d as { inputs?: unknown } | null)?.inputs, ctx) });
  if (saved) setInputs(saved);
}, []);
const result = useMemo(() => computeEnergy(inputs, ctx), [inputs]);        // text: result.warnings[i].key -> t(`energy.warning.${key}`)
useEffect(() => { writeStored("energy", { inputs, pv: inputs.pv }); }, [inputs]);   // `pv` is the part other pages read

// Model page (3D panels), Home, Budget: the same PV choice
const planes = ctx.planes;
const defaults = defaultPvSelection(house, planes, derived);
const sel = currentPvSelection(defaults, planes, house.equipment.battery.options.map((o) => o.id));   // client only
const layout = layoutPanels(planes, house.equipment.pv, { count: sel.panelCount, enabledPlanes: sel.enabledPlanes, obstacles: ctx.obstacles });
//   layout.panels[i].corners -> InstancedMesh; layout.kwp -> label

// Budget page
const site = createSite(siteJson, house.location.houseAxisBearingDeg);
const book = defaultPricebook();
const q = deriveQuantities(house, derived, site, { pv: { panelCount: layout.count, kwp: layout.kwp, batteryKwh } });
const budget = computeBudget(book, q, settings);       // settings: defaultBudgetSettings(book) + sanitized storage
// CSV: toCsv(budget, book, { locale, labels, unitLabel })

// Floor plan page: cards of the constructions
const card = assemblyBreakdown(house.assemblies.exteriorWall);   // layers, R, U; texts from layer.name[locale]

// Print: buildStl(derived, site, { scale: 200, ground: "plate" })  ->  Blob([buffer], { type: "model/stl" })
```

The budget is split so that the client bundle of the Budget page carries neither zod nor the plot code: the server runs
`deriveQuantities` (`budgetQuantities.ts`) and passes the numbers down, the client imports `budgetCore.ts` and `budgetCompute.ts`,
and `budget.ts` re-exports all four files for server code, scripts and tests.

A page never keeps a copy of a calc result in a second place: Home, Model and Budget call the same functions with the same
selection and so show the same kWp, and a test compares them (section 11).

## 4. `sun.ts`

Solar position, times, daily arcs and roof-overhang shading, for any place and time zone (`GeoPlace {lat, lon, tz}` from
`placeOf(house)`). Place and zone always come from the model (`placeOf(house)`).

| Function | Contract |
|---|---|
| `sunPosition(time, {lat, lon})` | NOAA/Meeus. Azimuth true `[0,360)`, altitude with refraction (`altitudeGeometric` without), declination, equation of time (min), hour angle. About 0.01° for 1950–2050, degrades slowly outside, never throws for dates; `RangeError` for non-finite time or `abs(lat) > 90`; longitude wrapped. |
| `zonedParts(ms, tz)`, `utcOffsetHours(ms, tz)`, `localToUtc(tz, date, hours?)` | Intl-based zone arithmetic, `hourCycle: "h23"` (never hour 24). `localToUtc` handles the skipped hour (maps just after the gap) and the repeated hour (first occurrence). Offsets may be fractional (`Asia/Kolkata`). |
| `monthOffsetMix(tz, year)` | Per month the UTC offsets at local noon with their share of days. Winter/summer months have one entry; March and October have two. Energy uses it to shift UTC profiles to local time. |
| `sunTimes(place, date)` | `sunrise`, `solarNoon`, `sunset` as wall-clock hours (`null` when the sun does not rise or set), `noonAltitude`, `dayLength` (elapsed time; 24 midnight sun, 0 polar night), `polar`, `civilDayHours` (23 or 25 on change days). Noon-centred: solar noon is the maximum of the altitude (golden-section search around the equation-of-time estimate); sunrise is the rise before that noon and sunset the set after it, each found by scanning the half day in 10-minute steps for a sign change of `altitude − SUNRISE_ALTITUDE` (−0.833°) and bisecting. Far from the meridian of the zone or at high latitudes a sunset can fall after midnight: it is then reported above 24 (24.1 = 00:06 the next day), a sunrise before midnight as a negative number. Agrees with the NOAA calculator to 2 minutes. |
| `sunArc(place, date, {stepMinutes=10, minAltitude=-0.5})` | Samples through the civil day (elapsed time from local midnight to midnight) above `minAltitude`. |
| `sunDay(place, date, opts)` | `{date, times, arc, hourMarks, declination}` for the Sun page. |
| `monthSummary(place, year)` | `sunTimes` on the 15th (`TYPICAL_DAY`) of each month. |
| `keyDays(place, year)` | `summerSolstice`, `winterSolstice` and both equinoxes: `equinox` (spring) and `autumnEquinox` (the zero of declination after the summer solstice), found from declination at local solar noon, not tabulated. |
| `sunDirection(azTrue, alt, bearing)` | Unit vector `[e, n, u]` in the house frame. |
| `cosIncidence(normal, dir)` | `max(0, n·d)`. Use `frame.n` of a roof plane or the outward normal of a wall. |
| `skyPoint(az, alt, radius)` | Polar sky diagram offsets (SVG, y down): `r = radius (90 − alt)/90`. |
| `sunHoursOnSurface(place, date, normal, bearing)` | Unobstructed direct hours on a plane, returned as `{hours, first, last}`: samples every `stepMinutes` (10) at the middle of the interval, counted when the sun is above `SUN_UP_ALTITUDE` (0°) and `dot(sun, normal) > 0` (the sun is in front of the surface). The analytic upper bound and test oracle for the ray-cast analysis (section 4.1). |
| `placeOf(house)`, `addDays`, `isValidDate`, `daysInMonthOf`, `clockHoursAt`, `compassPoint`, `COMPASS_POINTS`, `TYPICAL_DAY` (15), `SUNRISE_ALTITUDE`, `SUN_UP_ALTITUDE` | The place from the model, calendar arithmetic on `CalendarDate`, the wall-clock hour of an instant, the eight-point compass key of an azimuth (the page turns it into a word), and the named constants. |
| `overhangShadedFraction(window, sun)` | Share of the glazing height shaded by the roof edge: profile angle `atan(tan(alt)/cos(Δaz))`, shadow reaches `eaveHeight − depth·tan(profile)`. Long-overhang assumption, 0 when the sun is behind the wall plane. Inputs come from `DerivedOpening` (`azimuthTrue`, `sill`, `head`, `overhang {depth, eaveHeight}`). |
| `overhangDailyShading(place, date, window)` | Day average of the above weighted by `cosIncidence` on the wall. |

### 4.1 Ray-cast analysis (`src/lib/three/sunAnalysis.ts`)

Shadows from neighbours, trees and the house itself are not in calc. They come from the ray-cast analyser of the 3D engine,
`makeSunAnalyzer(viewer, house, opts?)`, which takes the astronomy from `calc/sun` and uses `sunHoursOnSurface` as the
unobstructed reference (it is the oracle of its tests). Options: `sunPosition` (inject a function in tests), `surroundings`,
`terrain`, `cull`.

* `day(date, step = 10, shades = [])` returns a `SunDayResult`: the sampled instants (`times`, `altitude`, `azimuthTrue`, only those with the sun above the horizon) and,
  per room with a glazed exterior opening, per terrace or covered area (with the movable shading as set) and per such area
  without the shading (`outdoorsOpen`), a `SunSeries {hours, fraction[]}`. Synchronous, some tens of milliseconds for a day.
* `dayAsync(date, step, shades, {signal, sliceMs = 8})` is the same result computed in slices that yield to the event loop
  (phones); it resolves `null` when the `AbortSignal` fires. The shades must not change meanwhile: abort first.
* `windows` and `areas` list what is sampled (`SampledWindow`: opening id, room id, outward normal, sample points; `SampledArea`), for tests and debugging.
* `terrainHorizon(azimuthTrue)` is the elevation in degrees of the terrain horizon seen from the house (negative when the ground
  falls away); the sun below it lights nothing.
* `blockers(origin, direction)` lists every static house mesh a ray meets, nearest first, with its role and id (debugging).
* An opening counts only while the sun is in front of its wall: `dot(sun, outward normal) > 0`, the same test as `sunHoursOnSurface`.
  Neighbours, trees, hedges and fences count with leaf-dependent transmittance (kernel `rayTransmittance`).

## 5. `roofLayout.ts`

One answer to "where are the panels". The geometry and the layout rule are the kernel's (`derived.roofPlanes`,
`layoutPv` in `src/lib/model/pv.ts`); this module groups faces into **planes**, gives each a **stable key**, places the number
of panels the visitor chose, and validates what was saved.

* `RoofPlane` = all faces of a kernel plane id (`"T1.N#1"` and `"T1.N#2"` are one plane `"T1.N"` with one frame). `key` is
  `planeKey(face)` = `<side><true azimuth>.<pitch>@<eave origin x>,<y>` with the origin in decimetres, for example `S192.22@0,-10`.
  It is built from geometry only: not from the order of the planes, not from ids, not from the splitting into faces.
  **Persist `key`, never an index and never `plane.id`.** A plane that moves gets a new key, and a saved choice that names the
  old one is dropped on load (`resolvePvSelection`), so a model change cannot silently apply old settings to other planes.
* `layoutPanels(planes, pv, {count, enabledPlanes, strategy, obstacles})`: capacity per plane is `layoutPv` applied to the faces
  of that plane with `facings: [side]` (the model's setbacks, gap, orientation and clearance around light pipes, which are
  passed as `obstacles = lightpipeObstacles(derived)`). Allocation of `count` over the enabled planes:
  * `"fill"` (default): planes ordered by `|aspect|` (nearest to south first; ties by area desc, then key), each filled before the next;
  * `"spread"`: one panel at a time round-robin over that order (E/W roofs produce evenly over the day).
  * within a plane: row by row from the eave; an incomplete row is taken from its centre outwards (symmetric array).
  * `count` is rounded, negative becomes 0, more than the capacity is clamped and `clamped: true` is reported.
* Defaults come from the model: `defaultPanelCount(derived) = derived.pv.count`, `defaultPvSelection` = those panels on the planes
  whose `side` is in `equipment.pv.layout.facings` and `equipment.battery.default`. With default options the layout equals
  `derived.pv` (same panels, same kWp): a test.
* `PvSelection {panelCount, enabledPlanes, batteryId}` is the visitor's choice. `batteryId` names one of the model's
  battery options (a value, not logic: the option with capacity 0 means "no battery").
* `resolvePvSelection(stored, defaults, planes, batteryIds)`: unknown plane keys are dropped; if nothing valid is left (or
  `null`) the default planes are used; a count that is not a finite number ≥ 0 gets the default; an unknown battery id gets the
  default. `currentPvSelection` = the same fed from `readStoredPv()` (client only; on the server it returns the defaults).
* `PanelLayout`: `panels[]` (kernel `PvPanel` plus `planeKey`, `side`; four 3D corners in the house frame), `planes[]` with
  `capacity`, `placed`, `kwp`, `orientation`, `rows`, totals `count`, `capacity`, `kwp`, `area`, `kwpBySide`, `countBySide`.

## 6. `uvalue.ts`

U-values by EN ISO 6946 and the floor on the ground by EN ISO 13370. Layers are listed from the **outside** to the inside (the
floor from the ground upwards), as in `house.assemblies`.

* `assemblyBreakdown(a)` returns every layer with its resistance, `ignored` (outside a ventilated layer, which does not
  contribute) and its `share` of the total resistance, plus `rLayers`, effective `rsi`/`rse` (with a ventilated layer `rse` is
  replaced by `rsi`), `rTotal` and `u`. `uValue(a)` equals the kernel's `assemblyU(a).U` to 1e-4 for every assembly: a test over
  all six assemblies and over random layer stacks.
* `layerResistance`: `r` when given, else `t/λ`; `RangeError` for a layer with neither or a non-positive thickness.
* `withLayerThickness`, `thicknessForU`: what-if helpers (insulation thickness for a target U); `thicknessForU` returns `null`
  when the target cannot be reached or the layer has no effect (outside a ventilated layer).
* `floorOnGround(input)`: `B' = A/(0.5 P)`, `d_t = w + λ (Rsi + R_f + Rse)`, `U = 2λ/(πB' + d_t) · ln(πB'/d_t + 1)` for `d_t < B'`,
  else `λ/(0.457 B' + d_t)`; `H_pe = 0.37 P λ ln(δ/d_t + 1)`; zero area or perimeter gives zeros. Soil `λ` and `δ` come from
  `assumptions.ground`, `w` from the model's exterior wall thickness, `R_f` from the `groundFloor` assembly.
* `SURFACE_RESISTANCE` (EN ISO 6946 table 7) for what-if constructions that have no assembly; the model's own `rsi`/`rse` win.

## 7. `energy.ts`

Indicative energy balance: heat demand, electricity of the heat pump, hot water, household and EV, PV production per roof
plane, hourly self-consumption with a battery, payback. It is not an energy performance certificate and the Energy page says so
(the sources and simplifications below are the text of its "what is calculated" panel).

### 7.1 Context and inputs

```ts
interface EnergyContext { house; derived; metrics; climate: ClimateData; assumptions: Assumptions; planes: RoofPlane[]; obstacles: Obstacle[] }
createEnergyContext({ house, derived, metrics?, climate, assumptions })   // pure; tests build their own (synthetic) houses with it
defaultEnergyContext()                                                    // the project's data, memoised
```

`EnergyInputs` is complete and flat: `indoorTempC persons dhwLitresPerPersonDay appliancesKwhYear evKmYear evChargeDaytime
heatRecovery n50 scop scopDhw dhwDaytime pv {panelCount, enabledPlanes, batteryId} priceBuy priceSell pvPricePerKwp
batteryPricePerKwh subsidy`. Ranges and defaults: `energyInputSpecs(ctx)` (from `assumptions.inputs`, with `scop`, `scopDhw` and
the switches defaulting to the model); sliders and number fields read their `min/max/step` from it, never from JSX.
`defaultInputs(ctx)` and `sanitizeInputs(raw, ctx)` as in section 1; `sanitizeInputs` is idempotent and accepts a saved object
with any subset of fields.

### 7.2 Method (what the bodies implement)

All geometry from `derived`/`metrics`; U-values from the assemblies (`derived.assemblies[*].U`, equal to `uvalue.ts`) and
`house.windows` (the `slider` override applies to sliding walls, `Ud` to opaque doors). Wall areas are to the wall axes (the same as `metrics.heated`); the roof and the floor use the outer face. `docs/ENERGY-ASSUMPTIONS.md` lists where the code departs from this description.

1. **Envelope** (`computeEnvelope`): rows `wall:<dir>`, `window:<dir>`, `slider:<dir>`, `door:<dir>`, `roof`, `floor`, `partition`
   (walls to unheated rooms, factor `b` from `assumptions.thermal.unheatedB` by room type), `bridge`
   (`ΔU` × area bordering the outside air). Roof over the **heated** rooms only (the garage has none): clip the roof faces to the
   heated rectangles (`clipRingToRect` in `src/lib/model/roofs.ts`, as `roofIntegrals` does). Floor: `floorOnGround`.
   `H_T = Σ A·U·b`.
2. **Ventilation**: `n_inf = e·n50`, hygiene flow `max(airflowPerPerson·persons, minAirChangeRate·V)`, mechanical flow equals that;
   `H_V = c_air·V·(n_inf + n_mech·(1 − recovery))`, `recovery` = model efficiency when `heatRecovery`, else 0; fans run
   continuously with `specificFanPower × flow` when the system is mechanical.
3. **Monthly heat demand** (EN ISO 13790): `Q_ht = [(H_T,air + H_V)(θi − θe,m) + H_floor(θi − θ̄e) + H_pe(θ̄e − θe,m)]·hours`, with `θe,m` the
   mean of `tempUTC[m]`; gains `Q_gn = Q_sol + Q_int`; `γ = Q_gn/Q_ht`, `a = 1 + τ/τ0`, `τ = C_m A_f/(H·3600)`; `η = utilisationFactor(γ, a)`;
   `Q_H,nd = max(0, Q_ht − η Q_gn)`. `Q_int = (persons·personW + applianceHeatShare·appliancesKwhYear·1000/8760)·hours`.
   `Q_sol` = Σ over **glazed exterior openings** (`glazingArea > 0`, heated room) of
   `glazingArea·(1 − frameShare)·g·solarCorrection·F_ob(m)·F_blind(m)·vertical[opening.dir][m]`, where only the direct part
   `b = thermal.verticalBeamShare` is shaded by the overhang: `F_ob = 1 − b·s` with `s = overhangDailyShading` on the typical day of the
   month, and `F_blind` mixes in `shading.blinds.closedFactor` for openings with `blind` by the
   share of hours the facade is above `closeAboveIrradiance` (estimated from the monthly vertical irradiation spread over the sun hours
   of the typical day; the estimate is documented in the code and tested for monotonicity). Facing of an opening is `opening.dir`, never typed.
4. **Hot water**: `persons·litres·1.163 Wh/(l K)·(setpointC − coldWaterC)·(1 + lossShare)·days`, set-point from the model.
5. **Electricity**: heating `Q_H,nd·(1 + distributionLossShare)/COP_m`. `COP_m = η_c·COP_Carnot(m)`, Carnot between a sink at
   `flowTemperatureC + sinkApproachK` and a source at `θe,m − sourceApproachK`; `η_c` is solved so that
   **`Σ heat / Σ electricity = scop` exactly** (a test). Hot water the same with `scopDhw`. Household: `appliancesKwhYear` by days.
   EV: `evKmYear × ev.kwhPerKm × (1 + ev.chargingLossShare)`; fans as above.
6. **Design load** (EN 12831, `computeDesignLoad`): `(H_T,air + H_V)(θi − θe,design) + H_floor·f_g1·(θi − θ̄e)`, no heat-up reserve;
   compared with `equipment.heating.ratedPowerKw` (warning `heatPumpUndersized` below 100 %).
7. **PV per plane** (`planeYield`): the climate file has the four house-frame facings at the roof pitch. A plane that equals its facing
   (azimuth and pitch within 1°, always so for the shipped model) uses the data unchanged, `factor` 1. Otherwise the true azimuth is
   transposed: the two bracketing facings are blended circularly, linearly in azimuth, and scaled by a clear-sky isotropic tilt
   ratio; yield falls monotonically as a plane turns away from south, and equal angles east and west of south give equal yields.
   Monthly energy per plane = `monthly[basis][m]·kWp`, hourly shape = `profileUTC` normalised, shifted UTC → local with
   `monthOffsetMix`. Clip at `equipment.pv.inverter.ratedKw` when `assumptions.pv.inverterClipping`.
8. **Hourly balance** (`simulateDay`): for each month the four day types (`clear partly overcast dark`) with production factor and
   weight from `assumptions.pv.dayTypes` (weights sum to 1, mean factor 1, so the month total is the PVGIS value). Loads: heating shaped
   by `heatingBaseShare` + degree-hours of the hourly temperature, hot water at `dhw.daytimeHours` (`dhwDaytime`) or
   `defaultHours`, household by `profiles.appliances`, EV by its hours, fans flat. Dispatch: PV serves load, surplus charges the
   battery (power and free capacity limit it, `√roundTrip` each way), the rest is exported; a deficit discharges the battery, the rest is imported.
   Each day is run twice for a steady state of charge; nothing carries over between day types or days. Battery: usable
   capacity `usableShare × capacityKwh`, power from the option.
9. **Economics**: `costWithoutPv = elTotal·priceBuy`; `costWithPv = import·priceBuy − export·priceSell`;
   `investmentGross = kWp·pvPricePerKwp + batteryKwh·batteryPricePerKwh` (battery only when kWp > 0), both prices and the subsidy clipped
   to ≥ 0, `investment = max(0, gross − subsidy)`; `payback = investment/savings` when both are positive and below
   `paybackCapYears`, else `null` with `status` `"never"` (savings ≤ 0 or too long) or `"none"` (nothing invested). `pvOnly` and
   `battery` split the result (a second dispatch without the battery).

### 7.3 Result and keys

`EnergyResult` = sanitised `inputs`, `envelope`, `ventilation`, `designLoad`, `layout` (`PanelLayout`), `planes[]` (energy per plane),
`months[12]`, `days[12]` (weighted mean day plus `types[]`), `totals`, `economics`, `warnings[]`. Keys for the dictionary:
`EnvelopeKind`, `DayTypeKey`, `PaybackStatus`, `EnergyWarningKey` (`climateMismatch panelsClamped noPlanesEnabled heatPumpUndersized
batteryWithoutPv inputsClamped`), `ClimateIssue`.

### 7.4 Known simplifications (shown to the visitor)

Monthly method, no night set-back, no cooling or summer overheating, constant SCOP shape by Carnot, typical days without
carry-over, battery without temperature or ageing effects, no tariffs by time of day, no degradation or price growth or
discounting in the payback, shading of windows by the roof overhang only (neighbours and trees are in the Sun page, not here).

## 8. Budget (`budget.ts` and the files behind it)

`budget.ts` is a barrel; the code lives in `budgetCore.ts` (quantity table, PV quantities, material take-off, the price book type and
`defaultPricebook()`), `budgetSchema.ts` (zod, server only), `budgetCompute.ts` (settings, totals, CSV) and `budgetQuantities.ts`
(`deriveQuantities`). Client components import `budgetCore` and `budgetCompute` directly (see section 3).

### 8.1 Quantities

`deriveQuantities(house, derived, site, {metrics?, pv?})` returns every key of `QUANTITY_KEYS` (always all of them, `0` when
the model has none of it). **`QUANTITY_DEFS` in `budgetCore.ts` is the normative list**: key, unit and an exact English definition.
Groups: plan and volumes (`footprintArea`, `floorAreaHeated`, `floorArea.<finish>`...), walls and surfaces (`extWallAreaGross`,
`extWallAreaOpaque`, `bearingWallArea`, `plasterArea`, `wetWallArea`, `woodCladdingArea`...), openings (`<kind>.count`,
`<kind>.area` for every `OpeningKind`, `windowSillLength`, `blind.*`), roof (`roofAreaSloped`, edge lengths by kind, `downpipe.count`,
`snowGuardLength`), equipment (`pv.count`, `pv.kwp`, `inverter.kw`, `battery.kwh`, `heatPump.kw`), outdoor areas and the plot (from
`analyzeSite`: `builtUpArea`, `hardSurfaceArea`, `greenArea`, `fenceLength`, `treeCount`, `earthwork*Volume`).

Rules: heights from the model (`clearHeight`, wall heights), never constants; walls are summed from `derived.walls` and the
interior walls count once (the walls come from `derived.walls`, not from room perimeters, which count shared walls twice and fail for plans with gaps); the outer face of exterior walls comes from the outline (`Σ outer wall length = outline perimeter`, a test); a roof
edge shared by two faces (ridge, hip, valley) is counted once. `pv` replaces the model's own PV count and battery with the
visitor's choice (from `energy`/`roofLayout`) so the Budget, Energy and Model pages show the same kWp.

`materialTakeoff(house, quantities)`: for each layer of each assembly the covered area (exterior wall × `extWallAreaOpaque`,
roof × `roofAreaOverFootprint`, ...) and the volume; generates the "materials" cards without typed coefficients.

`pvQuantities(house, derivedPv, choice?)` returns just the four PV keys (`PV_QUANTITY_KEYS`: `pv.count`, `pv.kwp`, `inverter.kw`, `battery.kwh`):
the model's own choice, or the visitor's `PvChoice {panelCount, kwp, batteryKwh}`. They are the only quantities that change without the geometry
changing, so a page runs the geometry once on the server and merges `pvQuantities` on the client after it has read the choice. `zeroQuantities()`
is the all-zero record (the start of `deriveQuantities`, an empty model for tests); `quantityFingerprintParts(q)` gives the rounded numbers behind the
fingerprint of stored edits; `ruleQuantity(rule, q)` evaluates the quantity rule of a price line (never negative, never NaN); `estimateBand(book, floorAreaHeated)`
is the orientation band from `book.benchmark`.

### 8.2 Budget

`computeBudget(book, quantities, settings?)` with `BudgetSettings {reserve, groups, overrides}`. Formulas (the doc comment of the
function repeats them): `works = Σ subtotal of groups with siteOverheadBasis`; overhead default price
`round(share·works/roundTo)·roundTo` (computed from the effective amounts, edits included; it is not in its own basis);
`core = Σ non-optional`, `extras = Σ optional and on`, `net = core + extras`, `reserve = r·net`,
`vat = Σ over groups on of subtotal·(1 + r)·rate(g)`, `total = net + reserve + vat`,
`coreWithVat = Σ non-optional of subtotal·(1 + r)·(1 + rate(g))`, `perM2 = coreWithVat/floorAreaHeated` (the house only: garage,
outdoor works and equipment that are optional groups do not distort it). `vatByClass` sums to `vat`.

An edit (`overrides[lineId] = {quantity?, price?}`) changes one line; nothing else moves except the overhang. Each `BudgetLine` keeps the
computed (`defaultQuantity`, `defaultPrice`) and the effective values so a page can show "edited" and offer reset.
`sanitizeBudgetSettings` drops unknown ids, non-finite and negative numbers, clamps the reserve, ignores switches of groups that are not
optional. **Edits are stored with the fingerprint of the quantities** (`fingerprint(Object.values(q).map(round))` in
`storageKeys`), so an edited quantity is never applied to a changed model.

`defaultBudgetSettings(book)` is the book's own choice (default reserve, optional groups in their default state, no edits). `BudgetResult` carries
`groups[]` (each with `on`, `vatClass`, `vatRate`, `subtotal`, `lines[]`; a `BudgetLine` has `quantityRef`, `waste`, `overhead`, `quantityEdited`, `priceEdited`
next to the values above), `works`, `core`, `extras`, `net`, `reserveShare`, `reserve`, `vat`, `vatByClass`, `total`, `coreWithVat`, `perM2` (`null` without floor
area) and `floorArea`.

### 8.3 CSV

`toCsv(result, book, {locale, labels, unitLabel})`: UTF-8 with BOM, CRLF, a header row, one row per line of the groups that are on,
a blank row, then net, reserve, VAT, total. Czech: `;` and decimal comma; English: `,` and decimal point; numbers without
thousands separators; quoting of cells that contain the separator, a quote or a line break. Labels are passed in (calc has no i18n).
No external spreadsheet library.

## 9. `storageKeys.ts` (implemented)

The one place that names `localStorage` entries (`hs-energy`, `hs-budget`, `hs-look`, `hs-furniture`, `hs-sun`, `hs-model`; the theme
key stays in `components/ui/themeScript.ts` because an inline script needs it). Add a key here and nowhere else.

* Entry = envelope `{v, fp, data}`. `v` = version of the shape of `data` (`STORAGE_VERSIONS`); a different version is "nothing saved"
  unless the reader passes `migrate`. `fp` = fingerprint of the model the data belongs to (optional).
* `readStored(key, {parse, fingerprint?, migrate?})`: `parse` is a total function from untrusted data to a valid value or `null`.
  `writeStored(key, data, {fingerprint?})`, `clearStored`. All three are wrapped in `try/catch` and are no-ops on the server, in private
  windows and when storage is blocked. They never throw.
* Read in an effect after mount, write in an effect after state changes; never during render. Do not write before the first read
  has finished (a `loaded` flag), or defaults overwrite what was saved.
* What goes in: only things a visitor chose. **Never store the order or the index of roof planes or any id that is not a stable
  key**: use `planeKey`. Drop unknown keys on read.
* The `energy` entry is `{inputs, pv: StoredPv, ...}`; `pv` is the part that Model, Home and Budget read through `readStoredPv()` /
  `currentPvSelection`. Whoever extends the energy entry keeps `pv` readable.
* `fingerprint(parts)` (FNV-1a, 8 hex digits) and `derivedFingerprint(derived)` (plane keys, PV capacity, counts, footprint) detect
  "the model changed". They are not security features.

## 10. `printModel.ts`

A printable massing model of the house as a binary STL. Pure TypeScript, no three.js (the Model page converts the same mesh itself), no text.

```ts
const mesh = buildPrintMesh(derived, site, { scale: 200, ground: "plate" });   // PrintMesh: metres, house frame (z up)
const report = reportOfMesh(mesh, { scale: 200, autoFit: true });              // what the file would be, for the UI
const stl = toBinaryStl(mesh, report.scale);                                   // ArrayBuffer; buildStl(...) does all three
```

* `buildPrintMesh(derived, site, opts)` returns a `PrintMesh {positions, triangleCount, parts, shells, bounds}`: `positions` is a `Float32Array` with 9 floats per
  triangle, counter-clockwise seen from outside. `parts` are the named groups (`walls`, `roof`, `outdoor`, `plate`, `terrain`) as triangle ranges
  `{name, first, count}`. `shells` are the closed solids they consist of (one per wall block, roof face, slab, post, plate or terrain slab) in triangle order; tests use them
  to check that every shell is a closed, outward-oriented 2-manifold with positive volume. `site` may be `null` unless `ground` is `"terrain"` (otherwise `TypeError`).
* Options (`PrintOptions`): `scale` (denominator, 200 = 1:200; `normalizeScale` rounds it to a whole number and clamps it to `PRINT_SCALE_RANGE`, 100 to 200, default 200; the presets are
  `PRINT_SCALES`: 100, 150, 200), `ground` (`"none" | "plate" | "terrain"`, default `"plate"`), `outdoor` (terraces, paving and posts as slabs, default true), `bedMm`
  (default 250) and `autoFit`.
* Geometry: the walls are one block per outer ring of `derived.outline.polygons` (holes respected) up to `wallTopOf(derived)` (the highest `wallTop` of the roofs, else
  `derived.defaultWallTop`); each roof face is a prism between its plane and a flat bottom `roofEdgeThicknessM` below the lowest eave (so the overhang has thickness); covered
  outdoor areas are slabs with posts; the ground is a flat plate or a slab that samples `site.terrain` on a regular grid (buildings start just below the lowest terrain vertex
  under them). Parts overlap by `overlapM` so a slicer fuses them. Top and bottom faces are triangulated by `triangulate(outer, holes)` in `triangulate.ts`: ear clipping,
  holes joined to the outer ring by bridges (after Eberly), counter-clockwise triangles that index `[...outer, ...holes]`.
* `PRINT_DEFAULTS` holds the named constants of the method (not house numbers): `bedMm` 250, `plateMarginM` 1, `terrainMarginM` 5, `plateThicknessM` 0.25, `roofEdgeThicknessM` 0.15,
  `overlapM` 0.05, `slabHeightM` 0.05, `postSizeM` 0.3, `terrainBaseM` 0.6, `terrainStepM` 1.
* Scale and bed: `checkBedFit(mesh, scale, bedMm)` returns `{sizeMm, bedMm, fits}` (the horizontal extent against a square bed; height is not limited);
  `fittingScale(mesh, preferred, bedMm)` is the smallest denominator at or above the preferred one that fits, or `null`; `reportOfMesh(mesh, {scale, bedMm, autoFit})` returns the
  `PrintReport` (`scale` actually used after clamping and `autoFit`, `sizeMm`, `fits`, `triangles`, `bytes`, `parts`) of an already built mesh, so a page builds the mesh once and asks
  for the report of each option; `printReport(derived, site, opts)` builds and reports in one call.
* STL: `toBinaryStl(mesh, scale)` writes an 80-byte ASCII header `House Sample 1:<scale>` (`STL_HEADER_PREFIX`), a `uint32` triangle count and 50 bytes per triangle (normal computed from
  the vertices, three vertices, attribute 0), float32 little-endian, millimetres = metres × 1000 / scale. `stlBytes(triangles)` is `84 + 50 × triangles`; `buildStl` is
  `toBinaryStl(buildPrintMesh(...), scale actually used)`. Two builds are byte-identical.

## 11. Tests: invariants and independent oracles

No golden numbers of the house anywhere. A test either states an **invariant** of the model/algorithm, compares with an **independent
oracle** (another formula, another route to the same number, brute-force sampling), or runs a **synthetic fixture** whose answer can be
computed by hand. Fixtures build their own tiny `House`/`Derived`/`ClimateData` with `createEnergyContext` or `HouseSchema.parse` of a
modified `house.json` (see `src/lib/model/__tests__/helpers.ts`). Each module has `src/lib/calc/__tests__/<module>.test.ts`; `api.test.ts` pins the surface (exports, data files, `planeKey`, `QUANTITY_DEFS`) and `jsonIdentity.test.ts` checks that the zod schemas accept the data files unchanged, so the browser can use the imported JSON without parsing it.

| Module | Must be tested |
|---|---|
| `sun` | **Oracles**: declination and equation of time against the Spencer series (0.3° and 1 min); sunrise/sunset against the hour-angle formula `cos H0 = (sin(−0.833°) − sinφ sinδ)/(cosφ cosδ)` (2 min); noon altitude `90 − abs(φ − δ)` (refraction ≤ 0.6°); published NOAA values are not typed in. **Invariants**: azimuth ≈ 180° at solar noon in the northern and ≈ 0° in the southern hemisphere; the arc is symmetric about solar noon; `dayLength = sunset − sunrise` in elapsed time; equator ≈ 12 h; polar day/night (`polar`, 24/0, `null` times) at 69.6° N on the solstices; fractional zone (`Asia/Kolkata`); **DST** on the days of the change (`civilDayHours` 23 and 25, `localToUtc` in the gap and the overlap, `zonedParts` round trip over a whole year for 3 zones); `monthOffsetMix` shares sum to 1 and have two entries exactly in the change months; `sunDirection` is unit length, east/north/up for azimuth 90/0, bearing shifts the azimuth; `sunHoursOnSurface` of a horizontal plane equals the hours above the horizon, of a vertical south wall is symmetric about noon; `overhangShadedFraction`: hand-computed case (sun straight on, `depth·tan(alt)` against `eaveHeight − head`), 0 behind the wall, monotone in altitude and depth, 1 when fully covered. |
| `roofLayout` | Default layout equals `derived.pv` (count, kWp, panel by panel); every panel lies inside its face (point-in-polygon in `(u,v)`), panels never overlap (rectangle intersection), setbacks respected; `Σ placed = count ≤ capacity`; `kwp = count·Wp/1000`; `count` monotone in the request and clamped with `clamped`; `"spread"` differs by at most one panel between planes of equal capacity; independence from the order of `enabledPlanes` and of the faces; keys unique and stable under reordering; `resolvePvSelection` drops unknown keys, ignores order, falls back on empty/garbage; what-if copy of `pv.layout.gap` changes capacity monotonically. |
| `uvalue` | Hand-computed single and multi-layer cases; all six assemblies equal the kernel's `assemblyU` to 1e-4; random stacks agree with the kernel; ventilated layer ignores the outside layers and uses `rsi` for `rse`; shares add up to 1; `thicknessForU` round trip; `floorOnGround` both branches, monotone in insulation and in `B'`, zeros for zero area. |
| `energy` | **Oracle**: `utilisationFactor` against the closed forms and the limits (`γ → 0`: 1; `γ = 1`: `a/(a+1)`; non-increasing); a one-room synthetic house whose `H_T`, `H_V`, `Q_ht` and heat demand are computed by hand in the test; the independent re-sum of the envelope from the raw model. **Invariants**: `Σ months = totals`; `import = consumption − self-use`; `production = self-use + export + battery losses` (`batteryIn − batteryOut`, zero without a battery; self-use counts what the battery gives back); hourly `pv = direct + toBattery + toGrid` and `load = direct + fromBattery + fromGrid`, `0 ≤ soc ≤ usable`, power limits; weights of the day types give the PVGIS month total; `Σ heat/Σ electricity = scop`; **monotonicity** (more panels, bigger battery, lower set-point, better U, higher recovery, tighter n50); zero panels give zero production, `payback null`, `status "none"`; `planeYield` equals the climate data for matching planes and is symmetric and monotone for rotated ones; `sanitizeInputs` idempotent, clamps, never NaN for random garbage (property test with a seeded generator); `computeEnergy` deterministic (two runs deep-equal) and does not mutate `ctx`; `checkClimate` flags a changed pitch/bearing/location. |
| `budget` | **Oracle**: floor, wall, roof and opening quantities recomputed from the raw `house.json` rectangles with the shoelace formula, not from `derived`; the invariants listed at `deriveQuantities`; roof edge lengths from an independent walk over `roofPlanes`. `computeBudget` against a straightforward recomputation on a synthetic book with hand-checked totals (toggle a group, edit one line, reserve 0 and max, two VAT classes, overhead with and without edits); `sanitizeBudgetSettings` property test; `toCsv` parsed back with a small CSV reader reproduces the totals, has BOM and CRLF, quotes correctly, and differs by locale only in separators. Cross-module: the price book's PV and battery lines equal the Energy price inputs with VAT (`api.test.ts`). |
| `printModel` | STL byte layout (`84 + 50·n`, header ASCII, counts); every part is a closed 2-manifold (each edge shared by exactly two triangles, consistent orientation) with positive volume; the volume of the wall block equals outline area × height (oracle from `derived.outline`); bounds of `plate` equal the bounding box plus margin; coordinates scale by `1000/scale`; scale clamped; `autoFit` picks a scale that fits; terrain top matches `site.terrain.groundAt` at the grid nodes; two builds are byte-identical. |
| `triangulate` | Triangles cover exactly the polygon (sampled points lie in one triangle if and only if inside, random rectilinear shapes with holes), holes and several holes joined to an L-shaped ring, both ring orientations, fewer than three vertices give nothing. |
| `storageKeys` | Envelope, versions, migration, fingerprint test vectors, never throws. |

Cross-module consistency (`consistency.test.ts`): the kWp shown by
Energy, the Model layer and Budget is the same number for the same selection; the Budget's PV investment equals the Energy gross
investment minus VAT; `deriveQuantities().pv.kwp` equals `layoutPanels(...).kwp` for default and for a random selection.

## 12. Decisions

1. `deriveQuantities` takes `(house, derived, site, opts)`, not `(derived, site)`: downpipes, snow guards, equipment and the layers of the assemblies are in the house model, not in `derived`. `defaultInputs(ctx)` takes the context, not the house: the defaults need the assumptions.
2. Months are 0-based everywhere in calc, matching `Date` and `src/lib/calendar.ts`.
3. The zod schemas of the two data files live in their own files (`energySchema.ts`, `budgetSchema.ts`) and the modules the browser loads import only their types. The JSON is used as imported, and `jsonIdentity.test.ts` pins that parsing it changes nothing. This keeps about 100 KB of zod out of the Energy and Budget bundles.
4. The energy module has no cooling or overheating model; it can be added as an extra key of `MonthResult` without changing what exists.
5. PV yield per plane is the PVGIS yield of the matching house-frame facing (exact for this model) with a documented transposition for other azimuths and pitches, instead of a full sky model.
6. Saved choices are keyed by geometry keys and carry a model fingerprint where numbers (not keys) are saved; old data is dropped, not migrated.
7. `model/assumptions.json` and `model/pricebook.json` are part of the content hash of `model/*.json` (`isHashedModelFile`), like every model file. A price change therefore changes `derived.inputHash` and the committed derived data and manifests must be regenerated (`npm run model:build`, `npm run models`) although the geometry is the same. The hash is stricter than it needs to be; one rule without exceptions was preferred to a list of excluded files.
