# Energy: assumptions and method

The Energy page is an **indicative** calculation, not an energy performance certificate. This document says where each number
of `model/assumptions.json` (`assumptions/1`, `meta.status: "reviewed"`) comes from and what the calculation in
`src/lib/calc/energy.ts` does with it. Geometry, constructions, equipment and location come from the house model, climate from
`src/lib/data/pvgis.json` (`docs/ENERGY-DATA.md`), prices of the build from `model/pricebook.json`.

## 1. Assumptions (model/assumptions.json)

All values are for Czechia, price level of 2026, and are meant as defaults that the visitor can change (the ranges are the
slider and field limits).

| Key | Value | Why |
|---|---|---|
| `climate.designOutdoorC` | -12 degC | EN 12831 national annex, Brno region (the site is in South Moravia). |
| `inputs.indoorTempC` | 21 (18 to 24) | Usual set-point of a living house; the model's own comfort target. |
| `inputs.persons` | 4 (1 to 8) | A family house. |
| `inputs.dhwLitresPerPersonDay` | 40 (20 to 100) | 35 to 50 litres per person and day at the set-point of the model (typical for Czech households). |
| `inputs.appliancesKwhYear` | 3000 (1000 to 8000) | Cooking, laundry, cooling, lighting, electronics of a family of four: 2 500 to 3 500 kWh. |
| `inputs.evKmYear` | 0 (0 to 40 000) | No car by default; the visitor adds one. |
| `inputs.n50` | 1.0 (0.3 to 6) | Air tightness of a careful new build; 0.3 is a passive house, 6 an old one. |
| `inputs.scop`, `scopDhw` | from the model (2 to 6, 1.5 to 4.5) | Taken from `equipment.heating`; the ranges cover air-to-water and ground-source pumps. |
| `inputs.priceBuy` | 4.7 CZK/kWh | Household electricity 2025 to 2026 with distribution and 21 % VAT, without fixed charges (from 2026 the state pays the renewable levy, which lowered the price). |
| `inputs.priceSell` | 1.2 CZK/kWh | Typical supplier offer for surplus from small PV (spot price minus margin). |
| `inputs.pvPricePerKwp`, `batteryPricePerKwh` | 26 880, 11 200 CZK | The price book's 24 000 and 10 000 CZK without VAT with the reduced residential rate of 12 %; a test keeps the two files equal. |
| `thermal.thermalBridgeDeltaU` | 0.02 W/(m2 K) | Well detailed constructions (ČSN 73 0540-2 allows 0.02 for a very good solution, 0.05 as the usual). |
| `thermal.internalHeatCapacityKjPerM2K` | 165 | Medium construction, EN ISO 13790 table 12. |
| `thermal.utilisationReferenceTimeH` | 15 | `tau0` of the monthly method. |
| `thermal.airHeatCapacityWhPerM3K` | 0.34 | Volumetric heat capacity of air. |
| `thermal.solarCorrection` | 0.9 | Non-perpendicular incidence and dirt on glazing. |
| `thermal.verticalBeamShare` | 0.7 | Share of the irradiation of a vertical facade that is direct (the roof overhang shades only this part). |
| `thermal.unheatedB.garage` | 0.5 | Temperature reduction factor of a garage with one outside wall (EN ISO 13789); other unheated types use 0.5 as well. |
| `ground.soilLambda`, `periodicDepthM` | 2.0 W/(m K), 3.2 m | Clay or silt, EN ISO 13370. |
| `ground.fg1` | 1.45 | Correction for the yearly swing of the outdoor temperature, EN 12831. |
| `ventilation.shielding` | 0.07 | Moderate shielding, `n_inf = e n50`. |
| `ventilation.airflowPerPersonM3h`, `minAirChangeRate` | 25 m3/h, 0.3 /h | Hygienic fresh air (ČSN EN 16798-1), minimum air change of a dwelling. |
| `gains.personW`, `applianceHeatShare` | 50 W, 0.7 | Metabolic heat averaged over presence; share of household electricity that ends as heat in the house. |
| `ev.kwhPerKm`, `chargingLossShare` | 0.17, 0.1 | Mid-size electric car, charger and battery losses. |
| `heating.distributionLossShare` | 0.06 | Losses of distribution and buffer storage. |
| `heating.copCurve` | 5 K, 8 K | Approach temperatures for the Carnot ratio of the COP curve (flow temperature of the model plus 5 K at the condenser, outdoor air minus 8 K at the evaporator). |
| `dhw.coldWaterC`, `lossShare` | 10 degC, 0.15 | Mains water; losses of tank and circulation. |
| `dhw.daytimeHours`, `defaultHours` | 11 to 14, 6 to 7 and 19 to 21 | Hours the water is heated with "when the sun shines" on and off. |
| `profiles.appliances` | 24 values | Household load profile of a family, normalised by the code. |
| `profiles.evDaytimeHours`, `evNightHours` | 10 to 15, 18 to 22 | Charging windows. |
| `profiles.heatingBaseShare` | 0.6 | Part of the heating electricity spread evenly; the rest follows degree-hours of the hour. |
| `pv.dayTypes` | clear 1.57 x 0.35, partly 1.07 x 0.30, overcast 0.56 x 0.20, dark 0.12 x 0.15 | Spread of daily production around the monthly mean day. Without dark days the balance would overestimate self-sufficiency by a few percentage points. The code rescales factors and weights to a mean of exactly 1 so that the month total is the PVGIS value. |
| `pv.inverterClipping` | true | The inverter's rated power (from the model) caps the production. |
| `battery.usableShare`, `roundTripEfficiency` | 0.9, 0.9 | Usable part of the nominal capacity; round-trip efficiency, half on each way. |
| `economy.paybackCapYears` | 30 | A payback longer than this is reported as "does not pay back". |

## 2. Method (what `computeEnergy` does)

1. **Envelope.** Rows by direction for walls, windows, sliding walls and doors (U from `house.windows`, the `slider` override for
   sliding walls), the roof over the heated rooms (faces clipped to the heated plan region, sloped area), the floor on the
   ground (EN ISO 13370 from the slab area and the exposed perimeter), walls and doors to unheated rooms with their `b` factor, and
   the thermal-bridge allowance on everything that borders the outside air. U-values come from the assemblies (`uvalue.ts`).
   Wall areas use the model's wall axes (as `metrics.heated`); the roof and the floor use the outer face (heated rooms grown by
   half an exterior wall).
2. **Ventilation.** `H_V = c_air V (e n50 + n_mech (1 - recovery))`, `n_mech = max(25 persons, 0.3 V) / V`. Fans run with heat recovery
   on and a mechanical system.
3. **Monthly heat demand** (EN ISO 13790): losses at the mean monthly outdoor temperature of the PVGIS temperature profiles, the
   ground with the annual mean and the periodic part, gains from people, appliances and the sun through each glazed opening
   (monthly irradiation of the facade from PVGIS, frame, g, correction, shading by the roof edge from `overhangDailyShading`, the
   blind closed for the share of irradiation above its threshold), utilisation factor, no cooling.
4. **Hot water, heat pump, electricity.** Hot water from litres, set-point and cold-water temperature. COP by month is the Carnot
   ratio times an efficiency solved so that the seasonal COP (heat delivered / electricity) equals the SCOP input exactly.
5. **PV per roof plane.** Data of the matching house-frame facing; planes that differ from a facing (more than 1 degree) are
   interpolated between the two neighbouring facings (linear in azimuth) and scaled by a clear-sky tilt ratio.
6. **Hourly balance.** Typical days of each month (four day types), loads by purpose, PV serves the load first, the battery takes
   the surplus (power and capacity limited, steady state at midnight found by bisection), the rest is exported.
7. **Economics.** Cost with and without PV, investment (PV and battery, subsidy shared in proportion), simple payback. A second
   dispatch without the battery gives the split between PV and battery.

## 3. Differences from `docs/CALC-API.md`

* `production = self-use + export` holds exactly without a battery; with one it is `self-use + export + (batteryIn - batteryOut)`,
  because self-use counts what the battery gives back, not what it takes in. `import = consumption - self-use` is exact.
* `utilisationFactor(0, a)` is 1 (the limit for no gains), not 0, so that the function is non-increasing everywhere.
* Dimensions of walls are to the wall axes, not the outer faces (a difference of about 2 % of the wall area).
* `computeEnergy` and the page results are deterministic within one JavaScript engine. V8 (the server) and JavaScriptCore
  (Safari) may differ in the last bits of `Math.pow` and `Math.sin`; the page rounds drawing coordinates before it writes them into
  attributes, otherwise React reports a hydration mismatch.

## 4. Known simplifications (also shown on the page)

Monthly method, no cooling or summer overheating, no night set-back, a Carnot-shaped COP curve, typical days without carry-over
between them, no temperature or ageing effects of the battery, no time-of-day tariffs, no panel degradation, no price growth, no
discounting in the payback, shading of windows by the roof overhang only (neighbours and trees are on the Sun page).
