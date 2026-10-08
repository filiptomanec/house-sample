# Energy data: photovoltaic yield and irradiance (PVGIS)

The Energy page (heat demand with solar gains, PV production, hourly self-consumption with battery) needs climate data for the
fictional site. They come from the EU **PVGIS** service and are stored in `src/lib/data/pvgis.json`. Nothing in that file is
typed in by hand: it is assembled by `scripts/build-pvgis.ts` from the raw API responses kept in `pipeline/data/pvgis/`.

```
scripts/fetch-pvgis.ts ──► pipeline/data/pvgis/*.json (raw responses + meta.json manifest)
scripts/build-pvgis.ts ──► src/lib/data/pvgis.json    (offline, deterministic)
```

## 1. Source

* Service: PVGIS 5.3 of the European Commission Joint Research Centre, API `https://re.jrc.ec.europa.eu/api/v5_3/`.
  PVGIS data may be reused with attribution; the website credits "EU JRC PVGIS".
* Radiation database: **PVGIS-SARAH3** (satellite based, covers Europe). Temperature: ERA5. Averaged years 2005 to 2023.
  The exact values are recorded in `meta` of the output (`radiationDb`, `meteoDb`, `years`).
* Horizon shading: PVGIS-calculated from its terrain model (`usehorizon=1`). The site is the fictional point
  49.2 N, 16.6 E (South Moravia, rounded to 0.1 degree); PVGIS reports 234 m terrain elevation for it, the house model assumes
  240 m, which is irrelevant for the radiation calculation.
* Only one location is ever requested; the position is rounded, so the raw files hold nothing more precise.

## 2. What is requested (12 requests, about 5 seconds)

The roof planes of the house have true azimuths `houseAxisBearingDeg + {0, 90, 180, 270}` (12, 102, 192, 282 degrees for a
bearing of 12). PVGIS uses *aspect*: 0 = south, +90 = west, -90 = east, 180 = north, so `aspect = azimuth - 180` folded into
(-180, 180]: 192 gives 12, 282 gives 102, 12 gives -168, 102 gives -78. The roof pitch is read from `model/house.json`
(`roofs[].pitch`; all roofs must share one pitch), the bearing from `location.houseAxisBearingDeg`, the position from
`location.lat/lon`; when a value is absent the fictional defaults in `scripts/fetch-pvgis.ts` apply. The resolved values and
where each came from are written to `pipeline/data/pvgis/meta.json`.

| Endpoint | Slope | Aspects (N, E, S, W facings) | Files | Used for |
| --- | --- | --- | --- | --- |
| `PVcalc` | roof pitch | 4 | `pvcalc-<F>.json` | monthly and yearly yield of 1 kWp |
| `DRcalc` (`month=0`, all months, UTC) | roof pitch | 4 | `dr-<F>.json` | average day per month: hourly irradiance on the roof plane, 2 m temperature |
| `DRcalc` | 90 (vertical) | 4 | `dr90-<F>.json` | irradiation of windows and walls (solar gains) |

`<F>` is the **house-frame facing**: `N` is the plane looking along the house +y axis, `S` the opposite one, `E` and `W` the
sides. They are not cardinal directions; the true azimuth of each is stored in `facings`.

Fixed PVcalc parameters: 1 kWp, crystalline silicon, free-standing mounting (ventilated roof-mounted panels), system loss 14 %.
Free-standing is PVGIS' normal assumption for roof racks; building-integrated panels would yield a few percent less.

## 3. Output format `pvgis/1`

| Key | Type | Meaning |
| --- | --- | --- |
| `schema` | `"pvgis/1"` | format version |
| `source` | `"pvgis" \| "model"` | provenance flag; `"model"` only for the offline fallback (section 5) |
| `meta` | object | `service`, `apiVersion`, `radiationDb`, `meteoDb`, `years` [first, last], `horizon`, `horizonDb`, `pvTechnology`, `mounting`, `retrieved` (date), `lat`, `lon`, `elevationM`. Compose any visible credit line from these through the i18n dictionaries; the file holds no prose |
| `slope` | number | pitch of the roof planes (degrees) |
| `loss` | number | system loss assumed in `monthly`/`yearly` (percent) |
| `houseAxisBearingDeg` | number | azimuth of the house +y axis |
| `facings` | `{N,E,S,W: {houseAzimuthDeg, azimuthDeg, pvgisAspect}}` | direction of each facing, house and true azimuth, PVGIS aspect |
| `monthly` | `{N,E,S,W: number[12]}` | kWh produced per kWp in each month (January first) |
| `yearly` | `{N,E,S,W: number}` | kWh per kWp and year (equals the sum of the months within rounding, 0.25 kWh) |
| `profileUTC` | `{N,E,S,W: number[12][24]}` | mean irradiance on the roof plane, W/m2, per month and **UTC** hour label (`HH:00` of PVGIS) |
| `tempUTC` | `number[12][24]` | mean 2 m air temperature, deg C, same indexing (identical for all planes) |
| `vertical` | `{N,E,S,W: number[12]}` | monthly irradiation of a vertical plane, kWh/m2, `sum_h(G_i) * days / 1000` from the slope 90 profiles |

Rounding: yield 0.01 kWh/kWp (months) and 0.1 (year), irradiance 0.1 W/m2, temperature 0.01 deg C, vertical 0.1 kWh/m2.
Months use a 365-day calendar (28 days in February).

How the numbers are meant to be used (this is what the Energy calculation does):

* Daily PV energy of a facing: `monthly[f][m] * kWp[f] / days[m]`; its hourly shape is `profileUTC[f][m][h]` divided by the sum
  of that row. Convert the UTC hour to local time with the offset of the typical day (+1 h in winter, +2 h in summer).
* Hourly outdoor temperature for the heating profile: `tempUTC[m][h]` with the same shift; monthly mean = mean of the 24 values.
* Solar gains through glazing: `vertical[facing of the opening][m]` times area and g-value factors (the facing of an opening
  is derived from the model, never typed in).

## 4. Regenerating

```
npx tsx scripts/fetch-pvgis.ts            # fetches missing files; --force refetches all; --budget-min=30 sets the retry budget
npx tsx scripts/build-pvgis.ts            # assembles src/lib/data/pvgis.json from the raw files, no network
npx tsx scripts/build-pvgis.ts --check    # exit 1 if the committed pvgis.json is not what the raw files produce
npx vitest run src/lib/data/__tests__/pvgis.test.ts
```

Regenerate whenever the roof pitch, the house axis bearing or the location in `model/*.json` changes: the test
suite compares `pvgis.json` with the model and fails when they disagree. The build step is idempotent (same raw files give the
same bytes), validates every raw file (requested slope/aspect, database, month and hour order, temperature series identical in
all eight DRcalc responses), validates the output with a zod schema and runs the range checks used by the tests
(yield of the best facing between 1000 and 1250 kWh/kWp, 24 hourly values, plausible temperatures).

Network behaviour of the fetch script: at most 4 requests per second, 60 s timeout per request, retry with exponential backoff
(2 s doubling up to 120 s, `Retry-After` honoured) on network errors, HTTP 408/425/429/5xx and broken JSON, for up to 30 minutes per
request. Client errors (HTTP 4xx other than the above) fail at once. Each response is checked and then written verbatim.

## 5. Offline fallback (not used for the committed data)

If PVGIS stays unreachable after the retry budget, `fetch-pvgis.ts` exits with code 2 and invents nothing. Only then
`npx tsx scripts/build-pvgis.ts --model` may be run: it computes the same file from a clear-sky model (Haurwitz) scaled to a
generic South Moravian climatology of monthly irradiation and temperature, with the Page diffuse fraction and an isotropic sky.
The result is flagged `source: "model"` and is typically within 10 % of PVGIS yearly yields (less accurate for north facing
and vertical planes). Replace it by real data as soon as the service is reachable again.

## 6. Other energy inputs

Tariffs, prices, efficiencies and household assumptions live in `model/assumptions.json` (`docs/ENERGY-ASSUMPTIONS.md`); they are
independent of the climate data described here.

The vertical irradiation (`vertical`) feeds two results of the energy balance: the solar gains of the heating balance (with the
blinds raised) and the summer solar load with the blinds' closing rule. The spread of the daily PV production (`pv.dayTypes` in
`model/assumptions.json`) is the same in every month. Monthly day types from an hourly PVGIS `seriescalc` series (quartiles of the
daily yield per month) would make the winter self-sufficiency more conservative; they need one more request to the service and are
not part of `pvgis/1` yet (an optional key `dayTypesByMonth` would be additive).
