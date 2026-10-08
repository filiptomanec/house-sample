// Energy balance of the house: transmission and ventilation losses from the real constructions and the derived envelope
// (EN ISO 13789, 13370), monthly heating demand with solar and internal gains (EN ISO 13790 monthly method), design heat
// load (EN 12831), heat pump (SCOP, COP by month), domestic hot water, household and EV electricity, PV yield per roof plane
// from PVGIS, hourly balance of typical days with a battery, and the payback of the PV system.
//
// Contract: docs/CALC-API.md, section 7. Pure functions, no DOM, no text (results carry numbers and keys; the page translates
// the keys), deterministic. The result is indicative, not an energy performance certificate.
//
// Same inputs give the same result, bit for bit, in one JavaScript engine. Engines may differ in the last bits of Math.pow,
// Math.sin and friends (V8 against JavaScriptCore), so a page that writes a computed number into an attribute rounds it first.
//
// Data sources (nothing about the house is typed in here):
//   house, derived, metrics   the model (src/lib/model/instance): envelope, openings, assemblies, equipment, location
//   climate                   src/lib/data/pvgis.json (docs/ENERGY-DATA.md)
//   assumptions               model/assumptions.json (schema in ./energySchema.ts): household, tariffs, profiles, day types, battery
import assumptionsJson from "@model/assumptions.json";
import climateJson from "@/lib/data/pvgis.json";
import { DAYS_IN_MONTH } from "@/lib/calendar";
import { DIRS, DIR_AZIMUTH } from "@/lib/model/catalog";
import type { Dir, OpeningKind } from "@/lib/model/catalog";
import { expandRect, unionOf, type Rect } from "@/lib/model/geom";
import { house as projectHouse, derived as projectDerived, metrics as projectMetrics } from "@/lib/model/instance";
import { computeMetrics } from "@/lib/model/metrics";
import type { Obstacle } from "@/lib/model/pv";
import { clipRingToRect } from "@/lib/model/roofs";
import type { Derived, DerivedOpening, House, Metrics } from "@/lib/model/types";
import type { Assumptions } from "./energySchema";
import { groupRoofPlanes, layoutPanels, lightpipeObstacles, defaultPvSelection, resolvePvSelection, type PanelLayout, type PvSelection, type RoofPlane } from "./roofLayout";
import { parseStoredPv } from "./storageKeys";
import { monthOffsetMix, overhangDailyShading, placeOf, sunHoursOnSurface, TYPICAL_DAY, type CalendarDate } from "./sun";
import { assemblyBreakdown, floorOnGround, uValue, type FloorOnGround } from "./uvalue";

// ================================================================================================ assumptions.json

/** Day types of the hourly balance. The page translates the keys. */
export const DAY_TYPE_KEYS = ["clear", "partly", "overcast", "dark"] as const;
export type DayTypeKey = (typeof DAY_TYPE_KEYS)[number];

/** User-adjustable numbers; each has a range (and usually a default) in `assumptions.inputs`. */
export const NUMERIC_INPUT_KEYS = [
  "indoorTempC",
  "persons",
  "dhwLitresPerPersonDay",
  "appliancesKwhYear",
  "evKmYear",
  "n50",
  "scop",
  "scopDhw",
  "priceBuy",
  "priceSell",
  "pvPricePerKwp",
  "batteryPricePerKwh",
  "subsidy",
] as const;
export type NumericInputKey = (typeof NUMERIC_INPUT_KEYS)[number];

/**
 * The type of `model/assumptions.json`. The zod schema (`AssumptionsSchema`, `parseAssumptions`) lives in ./energySchema.ts, which this
 * module never imports at run time: the browser bundle then carries no validator. A test checks that parsing the file changes nothing.
 */
export type { Assumptions };

// ================================================================================================ climate data

/** Shape of `src/lib/data/pvgis.json` (format `pvgis/1`, see docs/ENERGY-DATA.md). Facings are HOUSE-frame directions. */
export interface ClimateData {
  schema: "pvgis/1";
  source: "pvgis" | "model";
  meta: {
    service: string;
    apiVersion: string;
    radiationDb: string;
    meteoDb: string;
    years: [number, number];
    horizon: boolean;
    horizonDb: string;
    pvTechnology: string;
    mounting: string;
    retrieved: string;
    lat: number;
    lon: number;
    elevationM: number;
  };
  /** Pitch of the roof planes the data were computed for, degrees, and the system loss assumed, percent. */
  slope: number;
  loss: number;
  houseAxisBearingDeg: number;
  facings: Record<Dir, { houseAzimuthDeg: number; azimuthDeg: number; pvgisAspect: number }>;
  /** kWh per kWp and month (January first) / per year. */
  monthly: Record<Dir, number[]>;
  yearly: Record<Dir, number>;
  /** Mean irradiance on the roof plane, W/m2, [month][UTC hour label 0..23]. */
  profileUTC: Record<Dir, number[][]>;
  /** Mean 2 m air temperature, deg C, [month][UTC hour 0..23]. */
  tempUTC: number[][];
  /** Monthly irradiation of a vertical plane, kWh/m2, per house-frame facing. */
  vertical: Record<Dir, number[]>;
}

// ================================================================================================ context

/** Everything the calculation reads. Build it with `createEnergyContext` (tests, what-if) or `defaultEnergyContext()` (pages). */
export interface EnergyContext {
  house: House;
  derived: Derived;
  metrics: Metrics;
  climate: ClimateData;
  assumptions: Assumptions;
  /** Roof planes grouped from `derived.roofPlanes` (`groupRoofPlanes`). */
  planes: RoofPlane[];
  /** Roof penetrations for the PV layout (`lightpipeObstacles`). */
  obstacles: Obstacle[];
}

/** Builds a context from its parts; computes `planes` and `obstacles`, and `metrics` when not given. No I/O. */
export function createEnergyContext(parts: { house: House; derived: Derived; metrics?: Metrics; climate: ClimateData; assumptions: Assumptions }): EnergyContext {
  const { house, derived, climate, assumptions } = parts;
  return {
    house,
    derived,
    metrics: parts.metrics ?? computeMetrics(house, derived),
    climate,
    assumptions,
    planes: groupRoofPlanes(derived.roofPlanes),
    obstacles: lightpipeObstacles(derived),
  };
}

/**
 * The context of the project's own data: `house`, `derived`, `metrics` from "@/lib/model/instance", `src/lib/data/pvgis.json`
 * and `model/assumptions.json` (imported statically as "@model/assumptions.json"), built once and memoised.
 */
export function defaultEnergyContext(): EnergyContext {
  defaultContext ??= createEnergyContext({
    house: projectHouse,
    derived: projectDerived,
    metrics: projectMetrics,
    climate: climateJson as unknown as ClimateData,
    assumptions: assumptionsJson as unknown as Assumptions, // validated by the tests (energySchema.ts), not at run time
  });
  return defaultContext;
}
let defaultContext: EnergyContext | null = null;

/** Reasons why the climate file does not fit the model (the energy result is then flagged `climateMismatch`). */
export type ClimateIssue = "pitch" | "bearing" | "location";

/**
 * Compares the climate file with the model: roof pitch (every roof plane within 0.5 degree of `climate.slope`), house axis bearing
 * (within 0.5 degree) and location (lat/lon equal). Returns the failing checks, empty when the data belong to the model.
 */
export function checkClimate(house: House, derived: Derived, climate: ClimateData): ClimateIssue[] {
  const issues: ClimateIssue[] = [];
  if (derived.roofPlanes.some((f) => Math.abs(f.pitch - climate.slope) > CLIMATE_TOLERANCE_DEG)) issues.push("pitch");
  if (angleDiff(house.location.houseAxisBearingDeg, climate.houseAxisBearingDeg) > CLIMATE_TOLERANCE_DEG) issues.push("bearing");
  if (Math.abs(house.location.lat - climate.meta.lat) > 1e-6 || Math.abs(house.location.lon - climate.meta.lon) > 1e-6) issues.push("location");
  return issues;
}

/** Tolerance of the roof pitch and the house axis bearing against the climate file, degrees. */
const CLIMATE_TOLERANCE_DEG = 0.5;
/** A roof plane that is this close (azimuth and pitch, degrees) to a climate facing uses the facing's data unchanged. */
const EXACT_PLANE_DEG = 1;

/** Smallest absolute difference of two angles in degrees, 0..180. */
function angleDiff(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Signed difference a - b folded into (-180, 180]. */
function signedAngleDiff(a: number, b: number): number {
  const d = ((((a - b) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

// ================================================================================================ inputs

/** The adjustable inputs of the Energy page. Complete: every field always has a value. */
export interface EnergyInputs {
  /** Heating set-point, deg C. */
  indoorTempC: number;
  persons: number;
  /** Hot water use at the set-point temperature of the model, litres per person and day. */
  dhwLitresPerPersonDay: number;
  /** Household electricity (without heating, hot water, EV, ventilation), kWh per year. */
  appliancesKwhYear: number;
  evKmYear: number;
  evChargeDaytime: boolean;
  /** Heat recovery of the ventilation on (efficiency from the model) or off (windows / extract only). */
  heatRecovery: boolean;
  /** Air tightness n50, 1/h. */
  n50: number;
  /** Seasonal COP of space heating and of hot water production. */
  scop: number;
  scopDhw: number;
  /** Heat the water in the PV hours (`assumptions.dhw.daytimeHours`) instead of morning and evening. */
  dhwDaytime: boolean;
  /** The PV choice, shared with Model, Home and Budget (`resolvePvSelection`). */
  pv: PvSelection;
  /** Tariffs and investment, CZK. */
  priceBuy: number;
  priceSell: number;
  pvPricePerKwp: number;
  batteryPricePerKwh: number;
  subsidy: number;
}

export interface InputSpec {
  min: number;
  max: number;
  step: number;
  default: number;
}

/** Range and resolved default of every numeric input (defaults of `scop`/`scopDhw` come from the model). For sliders and fields. */
export function energyInputSpecs(ctx: EnergyContext): Record<NumericInputKey, InputSpec> {
  const fromModel: Partial<Record<NumericInputKey, number>> = {
    scop: ctx.house.equipment.heating.scop,
    scopDhw: ctx.house.equipment.heating.scopDhw,
  };
  const out = {} as Record<NumericInputKey, InputSpec>;
  for (const k of NUMERIC_INPUT_KEYS) {
    const r = ctx.assumptions.inputs[k];
    const wanted = r.default ?? fromModel[k] ?? r.min;
    out[k] = { min: r.min, max: r.max, step: r.step, default: Math.min(r.max, Math.max(r.min, wanted)) };
  }
  return out;
}

/** The default inputs: assumptions, the model's heating/ventilation/battery, and `defaultPvSelection`. */
export function defaultInputs(ctx: EnergyContext): EnergyInputs {
  const spec = energyInputSpecs(ctx);
  const num = (k: NumericInputKey): number => spec[k].default;
  return {
    indoorTempC: num("indoorTempC"),
    persons: num("persons"),
    dhwLitresPerPersonDay: num("dhwLitresPerPersonDay"),
    appliancesKwhYear: num("appliancesKwhYear"),
    evKmYear: num("evKmYear"),
    evChargeDaytime: ctx.assumptions.inputs.flags.evChargeDaytime,
    heatRecovery: ctx.house.equipment.ventilation.type === "mvhr",
    n50: num("n50"),
    scop: num("scop"),
    scopDhw: num("scopDhw"),
    dhwDaytime: ctx.assumptions.inputs.flags.dhwDaytime,
    pv: defaultPvSelection(ctx.house, ctx.planes, ctx.derived),
    priceBuy: num("priceBuy"),
    priceSell: num("priceSell"),
    pvPricePerKwp: num("pvPricePerKwp"),
    batteryPricePerKwh: num("batteryPricePerKwh"),
    subsidy: num("subsidy"),
  };
}

/**
 * Turns anything (saved JSON, a half-typed form) into complete valid inputs: missing or non-finite numbers take their default,
 * numbers are clamped to the ranges of the assumptions, booleans are coerced only from real booleans, the PV choice goes
 * through `resolvePvSelection`. Idempotent, never throws, never returns NaN.
 */
export function sanitizeInputs(raw: unknown, ctx: EnergyContext): EnergyInputs {
  const given: Record<string, unknown> = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const defaults = defaultInputs(ctx);
  const spec = energyInputSpecs(ctx);
  const out: EnergyInputs = { ...defaults };
  for (const k of NUMERIC_INPUT_KEYS) {
    const v = given[k];
    const sp = spec[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? Math.min(sp.max, Math.max(sp.min, roundToStep(v, sp.step))) : sp.default;
  }
  for (const k of ["evChargeDaytime", "heatRecovery", "dhwDaytime"] as const) {
    if (typeof given[k] === "boolean") out[k] = given[k];
  }
  out.pv = resolvePvSelection(parseStoredPv({ pv: given.pv }), defaults.pv, ctx.planes, ctx.house.equipment.battery.options.map((o) => o.id));
  return out;
}

/** Number of decimals that makes `step` exact (0.5 -> 1, 0.05 -> 2, 500 -> 0). */
function stepDecimals(step: number): number {
  for (let d = 0; d < 7; d++) if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-9) return d;
  return 6;
}

/** Rounds to the decimals of the step (what a number field shows), which keeps `sanitizeInputs` idempotent. */
function roundToStep(v: number, step: number): number {
  const f = 10 ** stepDecimals(step);
  return Math.round(v * f) / f;
}

// ================================================================================================ context-level data

/** Everything that depends on the model and the data files but not on the visitor's inputs, computed once per context. */
interface Prep {
  envelope: Envelope;
  /** Steady-state conductance of the floor on the ground (a row of the envelope) and the rest of the transmission, W/K. */
  hFloor: number;
  hTransmissionAir: number;
  /** Periodic conductance of the ground, W/K. */
  hPeriodic: number;
  /** Mean outdoor temperature per month and over the year (days-weighted), deg C. */
  monthMeanC: number[];
  yearMeanC: number;
  /** UTC offsets of the time zone per month with their shares (`monthOffsetMix`). */
  offsets: { offset: number; share: number }[][];
  /** Solar gains through the glazing per month, kWh (shading by the roof edge, blinds, frame, g, correction). */
  solarGainKwh: number[];
  /** Yield of 1 kWp per roof plane. */
  yields: Map<string, PlaneYield>;
}

const prepCache = new WeakMap<EnergyContext, Prep>();

function prepare(ctx: EnergyContext): Prep {
  const hit = prepCache.get(ctx);
  if (hit) return hit;
  const envelopeData = buildEnvelope(ctx);
  const hTransmissionAir = envelopeData.envelope.hTransmission - envelopeData.hFloor;
  const monthMeanC = ctx.climate.tempUTC.map((row) => row.reduce((s, v) => s + v, 0) / row.length);
  const totalDays = DAYS_IN_MONTH.reduce((s, d) => s + d, 0);
  const yearMeanC = monthMeanC.reduce((s, t, m) => s + t * DAYS_IN_MONTH[m], 0) / totalDays;
  const prep: Prep = {
    envelope: envelopeData.envelope,
    hFloor: envelopeData.hFloor,
    hTransmissionAir,
    hPeriodic: envelopeData.floor.hPeriodic,
    monthMeanC,
    yearMeanC,
    offsets: monthOffsetMix(ctx.house.location.tz, ctx.assumptions.climate.referenceYear),
    solarGainKwh: new Array<number>(12).fill(0),
    yields: new Map(),
  };
  prep.solarGainKwh = solarGains(ctx);
  for (const plane of ctx.planes) prep.yields.set(plane.key, planeYield(plane, ctx));
  prepCache.set(ctx, prep);
  return prep;
}

/** Heated rooms of the model; the garage and other rooms of an unheated type are not part of the thermal envelope. */
function heatedRoomIds(derived: Derived): Set<string> {
  return new Set(derived.rooms.filter((r) => r.heated).map((r) => r.id));
}

/** Direction (house frame) of an outward normal given by its house-frame azimuth: 0 N, 90 E, 180 S, 270 W. */
function dirOfAzimuth(az: number): Dir {
  return DIRS[((Math.round(az / 90) % 4) + 4) % 4];
}

/** Which row of the envelope an opening belongs to and its glazing properties (the sliding-wall override applies to sliders). */
function openingSpec(house: House, kind: OpeningKind): { row: "window" | "slider" | "door"; u: number; g: number; frameShare: number } {
  const w = house.windows;
  if (kind === "window") return { row: "window", u: w.Uw, g: w.g, frameShare: w.frameShare };
  if (kind === "slider") return { row: "slider", u: w.slider?.Uw ?? w.Uw, g: w.slider?.g ?? w.g, frameShare: w.slider?.frameShare ?? w.frameShare };
  return { row: "door", u: w.Ud, g: 0, frameShare: 1 };
}

/** Exterior openings of the heated rooms (windows, sliders, doors) with a direction. */
function heatedExteriorOpenings(derived: Derived): (DerivedOpening & { dir: Dir })[] {
  const heated = heatedRoomIds(derived);
  return derived.openings.filter((o): o is DerivedOpening & { dir: Dir } => o.exterior === true && o.dir !== null && o.room !== null && heated.has(o.room));
}

/**
 * Builds the envelope table from the derived model. Dimensions are to the wall axes (gross wall area = axis length x wall
 * height, as `metrics.heated`); the roof and the floor are taken over the heated plan region, which is the heated rooms grown
 * by half an exterior wall to the outer face. The roof is the sloped area of the roof faces over that region.
 */
function buildEnvelope(ctx: EnergyContext): { envelope: Envelope; hFloor: number; floor: FloorOnGround } {
  const { house, derived, assumptions: a } = ctx;
  const heated = heatedRoomIds(derived);
  const roomById = new Map(derived.rooms.map((r) => [r.id, r]));
  const rows: EnvelopeRow[] = [];
  const push = (kind: EnvelopeKind, dir: Dir | null, area: number, u: number, b: number, assembly: string | null) => {
    if (!(area > 0)) return;
    rows.push({ key: `${kind}:${dir ?? "-"}`, kind, dir, area, u, b, h: area * u * b, assembly });
  };

  // exterior walls and openings by direction
  const openings = heatedExteriorOpenings(derived);
  const uWall = uValue(house.assemblies.exteriorWall);
  const grossByDir: Record<Dir, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const w of derived.walls) {
    if (!w.ext || w.azimuth === undefined || !w.room || !heated.has(w.room)) continue;
    grossByDir[dirOfAzimuth(w.azimuth)] += w.len * (w.height ?? derived.defaultWallTop);
  }
  for (const dir of DIRS) {
    const openingArea = openings.filter((o) => o.dir === dir).reduce((s, o) => s + o.area, 0);
    push("wall", dir, Math.max(0, grossByDir[dir] - openingArea), uWall, 1, "exteriorWall");
  }
  for (const row of ["window", "slider", "door"] as const) {
    for (const dir of DIRS) {
      const mine = openings.filter((o) => o.dir === dir && openingSpec(house, o.kind).row === row);
      if (!mine.length) continue;
      const area = mine.reduce((s, o) => s + o.area, 0);
      const uArea = mine.reduce((s, o) => s + o.area * openingSpec(house, o.kind).u, 0);
      push(row, dir, area, uArea / area, 1, null);
    }
  }

  // plan region of the heated part (rooms grown to the outer face) and the roof above it
  const half = house.wall.ext / 2;
  const heatedRects: Rect[] = derived.rooms.filter((r) => r.heated).flatMap((r) => r.rects);
  const unheatedRects: Rect[] = derived.rooms.filter((r) => !r.heated).flatMap((r) => r.rects);
  const region = unionOf(heatedRects.map((r) => expandRect(r, half)));
  let roofArea = 0;
  for (const f of derived.roofPlanes) {
    const cos = Math.cos((f.pitch * Math.PI) / 180);
    for (const rect of region.rects) {
      const ring = clipRingToRect(f.pts, rect);
      if (ring) roofArea += ringAreaAbs(ring) / cos;
    }
  }
  push("roof", null, roofArea, uValue(house.assemblies.roof), 1, "roof");

  // floor on the ground (EN ISO 13370): the perimeter that borders the outside, not an unheated room
  const shared = unheatedRects.length
    ? Math.max(0, (unionOf(heatedRects).perimeter + unionOf(unheatedRects).perimeter - unionOf([...heatedRects, ...unheatedRects]).perimeter) / 2)
    : 0;
  const groundFloor = house.assemblies.groundFloor;
  const floor = floorOnGround({
    area: region.area,
    exposedPerimeter: Math.max(0, region.perimeter - shared),
    wallThickness: house.wall.ext,
    floorResistance: assemblyBreakdown(groundFloor).rLayers,
    rsi: groundFloor.rsi,
    rse: groundFloor.rse,
    soilLambda: a.ground.soilLambda,
    periodicDepthM: a.ground.periodicDepthM,
  });
  push("floor", null, region.area, floor.u, 1, "groundFloor");

  // walls and doors between a heated and an unheated room, with the temperature reduction factor of the unheated room
  let pArea = 0, pAU = 0, pAUb = 0;
  const kinds = new Set<string>();
  for (const w of derived.walls) {
    if (w.ext || !w.lo || !w.hi) continue;
    const lo = roomById.get(w.lo), hi = roomById.get(w.hi);
    if (!lo || !hi || lo.heated === hi.heated) continue;
    const inside = lo.heated ? lo : hi, outside = lo.heated ? hi : lo;
    const b = a.thermal.unheatedB[outside.type] ?? DEFAULT_UNHEATED_B;
    const assemblyKey = w.kind === "bearing" ? "bearingWall" : "partitionWall";
    const doors = derived.openings.filter((o) => o.wallId === w.id && o.exterior !== true);
    const doorArea = doors.reduce((s, o) => s + o.area, 0);
    const wallArea = Math.max(0, w.len * inside.height - doorArea);
    const uw = uValue(house.assemblies[assemblyKey]);
    kinds.add(assemblyKey);
    pArea += wallArea + doorArea;
    pAU += wallArea * uw + doorArea * house.windows.Ud;
    pAUb += (wallArea * uw + doorArea * house.windows.Ud) * b;
  }
  if (pArea > 0 && pAU > 0) push("partition", null, pArea, pAU / pArea, pAUb / pAU, kinds.size === 1 ? [...kinds][0] : null);

  // thermal bridges: an allowance on everything that borders the outside air
  const outside = rows.filter((r) => r.kind === "wall" || r.kind === "window" || r.kind === "slider" || r.kind === "door" || r.kind === "roof");
  push("bridge", null, outside.reduce((s, r) => s + r.area, 0), a.thermal.thermalBridgeDeltaU, 1, null);

  const hTransmission = rows.reduce((s, r) => s + r.h, 0);
  const lossArea = rows.filter((r) => r.kind !== "bridge" && r.kind !== "partition").reduce((s, r) => s + r.area, 0);
  const floorRow = rows.find((r) => r.kind === "floor");
  return {
    envelope: {
      rows,
      hTransmission,
      area: lossArea,
      uMean: lossArea > 0 ? hTransmission / lossArea : 0,
      heatedFloorArea: sum(derived.rooms.filter((r) => r.heated).map((r) => r.area)),
      heatedVolume: sum(derived.rooms.filter((r) => r.heated).map((r) => r.volume)),
    },
    hFloor: floorRow?.h ?? 0,
    floor,
  };
}

/** b factor of a wall to an unheated room whose type is not in `assumptions.thermal.unheatedB` (EN ISO 13789, a room with one outside wall). */
const DEFAULT_UNHEATED_B = 0.5;

const ringAreaAbs = (ring: readonly (readonly [number, number])[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
};

/**
 * Solar gains per month, kWh: for every glazed exterior opening of a heated room,
 *   A_glazing (1 - frame share) g F_w F_overhang F_blind H_vertical(facing, month),
 * with the correction F_w for non-perpendicular incidence and dirt, the roof edge shading only the direct share of the
 * irradiation (F_overhang = 1 - b s, s from `overhangDailyShading` on the typical day of the month), and the external blind
 * of the opening (if it has one) closed for the share of the facade's irradiation that arrives above the closing threshold.
 */
function solarGains(ctx: EnergyContext): number[] {
  const { house, derived, climate, assumptions: a } = ctx;
  const place = placeOf(house);
  const year = a.climate.referenceYear;
  const blinds = house.shading.blinds;
  const gains = new Array<number>(12).fill(0);
  const hoursCache = new Map<string, number>();
  for (const o of heatedExteriorOpenings(derived)) {
    if (!(o.glazingArea > 0)) continue;
    const spec = openingSpec(house, o.kind);
    const base = o.glazingArea * (1 - spec.frameShare) * spec.g * a.thermal.solarCorrection;
    for (let m = 0; m < 12; m++) {
      const date: CalendarDate = { year, month: m, day: TYPICAL_DAY };
      const shade = o.overhang
        ? overhangDailyShading(place, date, { azimuthTrue: o.azimuthTrue ?? 0, sill: o.sill, head: o.head, overhang: { depth: o.overhang.depth, eaveHeight: o.overhang.eaveHeight } })
        : 0;
      let blind = 1;
      if (o.blind) {
        const hk = `${o.dir}:${m}`;
        let hours = hoursCache.get(hk);
        if (hours === undefined) {
          const az = (DIR_AZIMUTH[o.dir] * Math.PI) / 180;
          hours = sunHoursOnSurface(place, date, [Math.sin(az), Math.cos(az), 0], house.location.houseAxisBearingDeg).hours;
          hoursCache.set(hk, hours);
        }
        const closed = closedShare(climate.vertical[o.dir][m] / DAYS_IN_MONTH[m], hours, blinds.closeAboveIrradiance);
        blind = 1 - closed * (1 - blinds.closedFactor);
      }
      gains[m] += base * (1 - a.thermal.verticalBeamShare * shade) * blind * climate.vertical[o.dir][m];
    }
  }
  return gains;
}

/**
 * Share (0..1) of the irradiation a facade receives in a day that arrives while its irradiance is above `thresholdWm2`. The
 * facade sees the sun for `sunHours`; the irradiance over that period is modelled as a half sine with the daily total
 * `dailyKwhM2`, peak G = pi H / (2 L). With r = threshold / peak the energy above the threshold is sqrt(1 - r^2) of the day's
 * (0 for r >= 1). It grows with the irradiation and falls with the threshold, which is all the blind logic needs.
 */
export function closedShare(dailyKwhM2: number, sunHours: number, thresholdWm2: number): number {
  if (!(dailyKwhM2 > 0) || !(sunHours > 0) || !(thresholdWm2 >= 0)) return 0;
  const peakWm2 = (Math.PI * dailyKwhM2 * 1000) / (2 * sunHours);
  const r = thresholdWm2 / peakWm2;
  return r >= 1 ? 0 : Math.sqrt(1 - r * r);
}


// ================================================================================================ envelope and ventilation

export type EnvelopeKind = "wall" | "window" | "slider" | "door" | "roof" | "floor" | "partition" | "bridge";

/** One line of the envelope table. */
export interface EnvelopeRow {
  /** `${kind}:${dir ?? "-"}`; unique, stable, safe as a React key and a translation key suffix. */
  key: string;
  kind: EnvelopeKind;
  /** House-frame direction of walls, windows, sliders and doors; null for roof, floor and the bridge allowance. */
  dir: Dir | null;
  /** Area, m2. */
  area: number;
  /** U-value, W/(m2 K); for the floor the equivalent steady-state U of EN ISO 13370; for the bridge row `thermalBridgeDeltaU`. */
  u: number;
  /** Temperature reduction factor (1 = outside air; below 1 towards an unheated room or the ground). */
  b: number;
  /** Heat transfer coefficient of the row, W/K: `area * u * b`. */
  h: number;
  /** Key of the model's assembly the U-value comes from (`exteriorWall`, `roof`, `groundFloor`...), null for openings and bridges. */
  assembly: string | null;
}

export interface Envelope {
  rows: EnvelopeRow[];
  /** Transmission heat transfer coefficient H_T, W/K: the sum of `h`. */
  hTransmission: number;
  /** Heat loss area (sum of the areas of the rows that border outside air), m2, and mean U = H_T / area. */
  area: number;
  uMean: number;
  heatedFloorArea: number;
  heatedVolume: number;
}

/**
 * Transmission through the heated envelope from the derived data and the assemblies (never from typed-in areas):
 * opaque exterior walls and openings by direction (U of windows, sliders, doors from `house.windows`), the roof over heated
 * rooms (`assemblies.roof`), the ground floor (EN ISO 13370 `floorOnGround`), walls to unheated rooms with their `b`, and the
 * thermal-bridge allowance. External dimensions (EN ISO 13789).
 */
export function computeEnvelope(ctx: EnergyContext): Envelope {
  return copyEnvelope(prepare(ctx).envelope);
}

/** The envelope is computed once per context and shared inside the module; callers get their own copy. */
function copyEnvelope(e: Envelope): Envelope {
  return { ...e, rows: e.rows.map((r) => ({ ...r })) };
}

export interface VentilationResult {
  /** Mean air flow through the heated volume, m3/h (hygiene need, at least the minimum air change rate). */
  airflowM3h: number;
  infiltrationAch: number;
  mechanicalAch: number;
  /** Heat recovery efficiency used (0 when off). */
  recovery: number;
  /** Ventilation heat transfer coefficient H_V = c_air * V * (n_inf + n_mech * (1 - recovery)), W/K. */
  hV: number;
  /** Electricity of the fans, W (continuous), 0 without mechanical ventilation. */
  fanW: number;
}

export function computeVentilation(inputs: EnergyInputs, ctx: EnergyContext): VentilationResult {
  const { assumptions: a, house } = ctx;
  const volume = prepare(ctx).envelope.heatedVolume;
  const vent = house.equipment.ventilation;
  // hygiene flow of the people, at least the minimum air change of the building; EN 15251 / ČSN EN 16798-1 give 25 m3/h per person
  const airflowM3h = Math.max(a.ventilation.airflowPerPersonM3h * inputs.persons, a.ventilation.minAirChangeRate * volume);
  const infiltrationAch = a.ventilation.shielding * inputs.n50;
  const mechanicalAch = volume > 0 ? airflowM3h / volume : 0;
  const recovery = inputs.heatRecovery ? vent.heatRecoveryEfficiency : 0;
  const hV = a.thermal.airHeatCapacityWhPerM3K * volume * (infiltrationAch + mechanicalAch * (1 - recovery));
  // the fans run only with heat recovery on (without it the house is ventilated through the windows) and a mechanical system
  const fanW = inputs.heatRecovery && vent.type !== "natural" ? vent.specificFanPower * airflowM3h : 0;
  return { airflowM3h, infiltrationAch, mechanicalAch, recovery, hV, fanW };
}

export interface DesignLoad {
  outdoorC: number;
  indoorC: number;
  transmissionW: number;
  groundW: number;
  ventilationW: number;
  totalW: number;
  /** W per m2 of heated floor. */
  specificWm2: number;
  /** Rated power of the model's heat pump, kW, and its coverage of the design load (rated / design). */
  ratedKw: number;
  coverage: number;
}

/** Design heat load by EN 12831 (no heat-up reserve): losses to the outside at the design temperature, ground via `ground.fg1`. */
export function computeDesignLoad(inputs: EnergyInputs, ctx: EnergyContext): DesignLoad {
  const prep = prepare(ctx);
  const { designOutdoorC } = ctx.assumptions.climate;
  const dT = inputs.indoorTempC - designOutdoorC;
  const hV = computeVentilation(inputs, ctx).hV;
  const transmissionW = prep.hTransmissionAir * dT;
  // EN 12831: the ground enters with the annual mean outdoor temperature and the correction f_g1 for its yearly swing
  const groundW = prep.hFloor * ctx.assumptions.ground.fg1 * (inputs.indoorTempC - prep.yearMeanC);
  const ventilationW = hV * dT;
  const totalW = Math.max(0, transmissionW + groundW + ventilationW);
  const floorArea = prep.envelope.heatedFloorArea;
  const ratedKw = ctx.house.equipment.heating.ratedPowerKw;
  return {
    outdoorC: designOutdoorC,
    indoorC: inputs.indoorTempC,
    transmissionW,
    groundW,
    ventilationW,
    totalW,
    specificWm2: floorArea > 0 ? totalW / floorArea : 0,
    ratedKw,
    coverage: totalW > 0 ? (ratedKw * 1000) / totalW : 0,
  };
}

// ================================================================================================ photovoltaics

export interface PlaneYield {
  planeKey: string;
  /** Climate facing used as the basis and whether the plane matches it (azimuth within 1 degree, pitch within 1 degree). */
  basis: Dir;
  exact: boolean;
  /** Ratio of the plane's yield to the basis facing's yield (1 when exact). */
  factor: number;
  /** kWh per kWp and month / year. */
  monthly: number[];
  yearly: number;
  /** Hourly shape in UTC per month, W/m2 (relative values are what matters), [12][24]. */
  profileUTC: number[][];
}

/**
 * Yield of 1 kWp on a roof plane. The climate file holds the four house-frame facings at the roof pitch. When the plane equals
 * its facing's geometry (always so for the shipped model) the data are returned unchanged (`factor` 1). Otherwise the true
 * azimuth is transposed: the two bracketing facings are blended (circular, linear in azimuth) and scaled by the ratio of the
 * plane's to the data plane's clear-sky irradiation (isotropic-sky tilt factor with the declination of the typical day), so a
 * plane rotated away from south yields monotonically less and E/W planes at equal angles from south yield equal amounts.
 */
export function planeYield(plane: RoofPlane, ctx: EnergyContext): PlaneYield {
  const { climate } = ctx;
  const facings = DIRS.map((d) => ({ dir: d, azimuth: climate.facings[d].azimuthDeg }));
  const nearest = facings.reduce((best, f) => (angleDiff(plane.azimuthTrue, f.azimuth) < angleDiff(plane.azimuthTrue, best.azimuth) ? f : best));
  const yearly = (monthly: readonly number[]): number => monthly.reduce((s, v) => s + v, 0);

  if (angleDiff(plane.azimuthTrue, nearest.azimuth) <= EXACT_PLANE_DEG && Math.abs(plane.pitch - climate.slope) <= EXACT_PLANE_DEG) {
    const monthly = [...climate.monthly[nearest.dir]];
    return { planeKey: plane.key, basis: nearest.dir, exact: true, factor: 1, monthly, yearly: yearly(monthly), profileUTC: climate.profileUTC[nearest.dir].map((row) => [...row]) };
  }

  // the facings just before and after the plane's azimuth (counter-clockwise and clockwise)
  const delta = facings.map((f) => ({ ...f, d: signedAngleDiff(plane.azimuthTrue, f.azimuth) }));
  const before = delta.filter((f) => f.d >= 0).reduce((best, f) => (f.d < best.d ? f : best), { ...delta[0], d: Infinity });
  const after = delta.filter((f) => f.d < 0).reduce((best, f) => (f.d > best.d ? f : best), { ...delta[0], d: -Infinity });
  const gap = before.d - after.d;
  const w = Number.isFinite(gap) && gap > 0 ? before.d / gap : 0; // 0 at the facing before, 1 at the facing after
  const lo = Number.isFinite(before.d) ? before.dir : after.dir;
  const hi = Number.isFinite(after.d) ? after.dir : before.dir;
  const blend = (a: number, b: number): number => (1 - w) * a + w * b;

  // pitch: the data are for the roof pitch; other pitches are scaled by the clear-sky ratio of the two tilts
  const lat = ctx.house.location.lat;
  const monthly = climate.monthly[lo].map((v, m) => {
    const ratio = Math.abs(plane.pitch - climate.slope) < 1e-9 ? 1 : tiltRatio(lat, m, plane.pitch, climate.slope, plane.azimuthTrue);
    return blend(v, climate.monthly[hi][m]) * ratio;
  });
  const profileUTC = climate.profileUTC[lo].map((row, m) => row.map((v, h) => blend(v, climate.profileUTC[hi][m][h])));
  const basisYear = yearly(climate.monthly[nearest.dir]);
  return { planeKey: plane.key, basis: nearest.dir, exact: false, factor: basisYear > 0 ? yearly(monthly) / basisYear : 1, monthly, yearly: yearly(monthly), profileUTC };
}

/**
 * Ratio of the clear-sky irradiation (isotropic sky, Meinel beam, ground albedo 0.2) of a plane with tilt `pitch` to that of a
 * plane with tilt `reference`, both with the same azimuth, on the typical day of the month. Only the ratio is used, so the
 * absolute level of the model does not matter; 1 when the sun never rises above the horizon.
 */
export function tiltRatio(latDeg: number, month: number, pitchDeg: number, referenceDeg: number, azimuthDeg: number): number {
  const day = DAYS_IN_MONTH.slice(0, month).reduce((s, d) => s + d, 0) + TYPICAL_DAY;
  const base = clearSkyDaily(latDeg, day, referenceDeg, azimuthDeg);
  return base > 0 ? clearSkyDaily(latDeg, day, pitchDeg, azimuthDeg) / base : 1;
}

const DEG = Math.PI / 180;

/** Daily clear-sky irradiation on a tilted plane in arbitrary units (sum of 2.5-degree hour-angle samples of the irradiance, W/m2). */
function clearSkyDaily(latDeg: number, dayOfYear: number, pitchDeg: number, azimuthDeg: number): number {
  const lat = latDeg * DEG;
  const dec = 23.45 * DEG * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365); // Cooper
  const beta = pitchDeg * DEG, az = azimuthDeg * DEG;
  const nE = Math.sin(beta) * Math.sin(az), nN = Math.sin(beta) * Math.cos(az), nU = Math.cos(beta);
  let sum = 0;
  for (let hourAngle = -178.75; hourAngle < 180; hourAngle += 2.5) {
    const w = hourAngle * DEG;
    const cosZ = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(w);
    if (cosZ <= 0.02) continue;
    const sunE = -Math.cos(dec) * Math.sin(w); // east of the meridian in the morning (negative hour angle)
    const sunN = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(w);
    const beam = CLEAR_SKY_SOLAR_CONSTANT * Math.pow(0.7, Math.pow(1 / cosZ, 0.678)); // Meinel and Meinel
    const diffuse = 0.1 * beam;
    const incidence = Math.max(0, nE * sunE + nN * sunN + nU * cosZ);
    sum += beam * incidence + (diffuse * (1 + Math.cos(beta))) / 2 + (GROUND_ALBEDO * (beam * cosZ + diffuse) * (1 - Math.cos(beta))) / 2;
  }
  return sum;
}

const CLEAR_SKY_SOLAR_CONSTANT = 1361;
const GROUND_ALBEDO = 0.2;

// ================================================================================================ hourly balance

/** 24 values for the wall-clock hours 0..23 of a typical day; kWh in that hour (numerically the mean kW). */
export type Hourly = number[];

export interface DayFlows {
  /** Electricity demand (heat pump, hot water, household, EV, fans). */
  load: Hourly;
  /** PV production after inverter clipping. */
  pv: Hourly;
  /** PV used directly, to the battery, battery to the load, export to the grid, import from the grid. */
  direct: Hourly;
  toBattery: Hourly;
  fromBattery: Hourly;
  toGrid: Hourly;
  fromGrid: Hourly;
  /** Energy stored at the END of the hour, kWh (usable capacity basis). */
  soc: Hourly;
}

export interface DayLoadParts {
  heat: Hourly;
  dhw: Hourly;
  appliances: Hourly;
  ev: Hourly;
  ventilation: Hourly;
}

export interface DayTypeProfile extends DayFlows {
  key: DayTypeKey;
  weight: number;
  /** Production factor of the day type relative to the monthly mean day. */
  pvFactor: number;
}

/** The typical day of a month: the weighted mean of its day types (what the charts show) and the day types themselves. */
export interface DayProfile extends DayFlows {
  /** 0-based month. */
  month: number;
  parts: DayLoadParts;
  types: DayTypeProfile[];
}

export interface BatteryModel {
  /** Usable capacity, kWh (nominal * usable share), power limit for charging and discharging, kW, round-trip efficiency 0..1. */
  usableKwh: number;
  powerKw: number;
  roundTripEfficiency: number;
}

/**
 * Hourly dispatch of one day: PV serves the load first, the surplus charges the battery (power and free capacity limit it,
 * efficiency sqrt(roundTrip) each way), the rest is exported; deficits discharge the battery, the rest is imported. The day is
 * run twice so that the state of charge at midnight is the steady state. Hour by hour, to numerical precision:
 *   pv = direct + toBattery + toGrid   and   load = direct + fromBattery + fromGrid,
 * 0 <= soc <= usableKwh, charge and discharge <= powerKw. `inverterKw` (optional) clips the PV before dispatch.
 */
export function simulateDay(pv: readonly number[], load: readonly number[], battery: BatteryModel, inverterKw?: number): DayFlows {
  const n = pv.length;
  if (load.length !== n) throw new RangeError(`simulateDay: pv has ${n} values but load has ${load.length}`);
  const clip = inverterKw === undefined ? Infinity : Math.max(0, inverterKw);
  const p = pv.map((v) => Math.min(clip, Math.max(0, Number.isFinite(v) ? v : 0)));
  const l = load.map((v) => Math.max(0, Number.isFinite(v) ? v : 0));
  const eta1 = Math.sqrt(Math.min(1, Math.max(0, battery.roundTripEfficiency)));
  const usable = eta1 > 0 ? Math.max(0, battery.usableKwh) : 0;
  const power = Math.max(0, battery.powerKw);

  const flows: DayFlows = { load: l, pv: p, direct: [], toBattery: [], fromBattery: [], toGrid: [], fromGrid: [], soc: [] };
  const pass = (start: number, record: boolean): number => {
    let soc = start;
    for (let i = 0; i < n; i++) {
      const direct = Math.min(p[i], l[i]);
      let toB = 0, fromB = 0;
      if (p[i] > l[i]) {
        toB = Math.max(0, Math.min(p[i] - l[i], power, eta1 > 0 ? (usable - soc) / eta1 : 0));
        soc += toB * eta1;
      } else {
        fromB = Math.max(0, Math.min(l[i] - p[i], power, soc * eta1));
        soc -= fromB / eta1;
      }
      soc = Math.min(usable, Math.max(0, soc));
      if (record) {
        flows.direct.push(direct);
        flows.toBattery.push(toB);
        flows.fromBattery.push(fromB);
        flows.toGrid.push(Math.max(0, p[i] - l[i] - toB));
        flows.fromGrid.push(Math.max(0, l[i] - p[i] - fromB));
        flows.soc.push(soc);
      }
    }
    return soc;
  };
  // The state of charge at midnight must be the steady state of the repeated day. The end-of-day state F(s) of a day that starts
  // with s is continuous, non-decreasing and maps [0, usable] into itself, so a fixed point exists and bisection finds it.
  let lo = 0, hi = usable;
  for (let k = 0; k < STEADY_BISECTIONS && hi - lo > 1e-14; k++) {
    const mid = (lo + hi) / 2;
    if (pass(mid, false) > mid) lo = mid;
    else hi = mid;
  }
  const start = (lo + hi) / 2;
  pass(start, true);
  return flows;
}

/** Bisection steps for the steady-state charge at midnight (the interval halves each time; 60 reach double precision). */
const STEADY_BISECTIONS = 60;

/**
 * Utilisation factor of the gains, EN ISO 13790 (monthly method), heating mode: `gamma` = gains / losses, `a = a0 + tau / tau0`.
 * eta = (1 - gamma^a) / (1 - gamma^(a+1)), valid for every positive gamma; a / (a + 1) at gamma = 1; 1 for gamma <= 0
 * (no gains, the limit from above); 0 for gamma = Infinity (no losses) and for NaN. Always within [0, 1] and non-increasing
 * in gamma. Evaluated for gamma > 1 as (1/gamma) (1 - g^a) / (1 - g^(a+1)) with g = 1/gamma, so that nothing overflows.
 */
export function utilisationFactor(gamma: number, a: number): number {
  if (Number.isNaN(gamma) || Number.isNaN(a)) return 0;
  if (gamma <= 0) return 1;
  if (gamma === Infinity) return 0;
  if (Math.abs(gamma - 1) < 1e-9) return a / (a + 1);
  if (gamma < 1) return (1 - Math.pow(gamma, a)) / (1 - Math.pow(gamma, a + 1));
  const g = 1 / gamma;
  return (1 / gamma) * ((1 - Math.pow(g, a)) / (1 - Math.pow(g, a + 1)));
}

// ================================================================================================ result

export interface MonthResult {
  /** 0-based month and number of days (non-leap year, `DAYS_IN_MONTH` of src/lib/calendar.ts). */
  month: number;
  days: number;
  /** Mean outdoor temperature, deg C (mean of `tempUTC[month]`). */
  outdoorC: number;
  /** Heat losses (transmission + ventilation + ground) and gains, kWh. */
  lossKwh: number;
  solarGainKwh: number;
  internalGainKwh: number;
  /** gains / losses and the utilisation factor of the gains; gamma is null when the losses are 0. */
  gamma: number | null;
  utilisation: number;
  /** Heating demand, kWh (>= 0) and hot water heat, kWh. */
  heatNeedKwh: number;
  dhwHeatKwh: number;
  /** COP of space heating in this month (null when there is no heating demand). */
  copHeat: number | null;
  /** Electricity by purpose, kWh. */
  elHeatKwh: number;
  elDhwKwh: number;
  elApplianceKwh: number;
  elEvKwh: number;
  elVentKwh: number;
  elTotalKwh: number;
  /** PV production, direct and battery self-use, export, import, kWh. */
  pvKwh: number;
  selfUseKwh: number;
  exportKwh: number;
  importKwh: number;
  /** Energy delivered into / out of the battery, kWh. */
  batteryInKwh: number;
  batteryOutKwh: number;
}

export interface PlaneEnergy {
  planeKey: string;
  side: Dir;
  kwp: number;
  /** Production of the placed panels, kWh per month and year, and per kWp. */
  monthlyKwh: number[];
  yearlyKwh: number;
  specificYield: number;
  /** Transposition used (see `planeYield`). */
  basis: Dir;
  exact: boolean;
}

export interface EnergyTotals {
  heatNeedKwh: number;
  /** kWh per m2 of heated floor and year. */
  specificHeatNeed: number;
  dhwHeatKwh: number;
  elHeatKwh: number;
  elDhwKwh: number;
  elApplianceKwh: number;
  elEvKwh: number;
  elVentKwh: number;
  elTotalKwh: number;
  /** Seasonal COP actually obtained, heat / electricity (equals the `scop` input when there is heating demand). */
  heatPumpSeasonalCop: number | null;
  kwp: number;
  /** PV production after the inverter's clipping (the sum of `planes[].yearlyKwh` before it). */
  pvKwh: number;
  /** kWh per kWp, null without panels. */
  pvSpecificYield: number | null;
  selfUseKwh: number;
  exportKwh: number;
  importKwh: number;
  /** Share of the consumption covered by PV (self-use / consumption) and of the production used on site (self-use / production). */
  selfSufficiency: number;
  selfConsumption: number;
  /** Full equivalent battery cycles per year (0 without battery). */
  batteryCycles: number;
}

/** "ok": pays back within the cap; "never": savings <= 0 or longer than the cap; "none": nothing was invested. */
export type PaybackStatus = "ok" | "never" | "none";

export interface PaybackPart {
  savings: number;
  investment: number;
  paybackYears: number | null;
  status: PaybackStatus;
}

export interface Economics {
  /**
   * Annual electricity bill without PV and with PV and battery, CZK: purchases minus the payment for the surplus, plus the fixed
   * charges of the connection (`assumptions.economy.fixedChargesPerYear`); their difference is the saving. Below the fixed charges
   * (even negative) when the surplus sold earns more than the purchases cost.
   */
  costWithoutPv: number;
  costWithPv: number;
  savings: number;
  /** Investment before and after the subsidy (>= 0), CZK; the subsidy is clipped to [0, gross]. */
  investmentGross: number;
  investment: number;
  paybackYears: number | null;
  status: PaybackStatus;
  /** The same for the PV without battery, and what the battery adds (savings and investment of the battery alone). */
  pvOnly: PaybackPart;
  battery: PaybackPart;
}

export type EnergyWarningKey =
  | "climateMismatch"
  | "panelsClamped"
  | "noPlanesEnabled"
  | "heatPumpUndersized"
  | "batteryWithoutPv"
  | "inputsClamped";

export interface EnergyWarning {
  key: EnergyWarningKey;
  /** A number the message can show (for example the coverage of the design load). */
  value?: number;
}

export interface EnergyResult {
  /** The inputs actually used (sanitised). */
  inputs: EnergyInputs;
  envelope: Envelope;
  ventilation: VentilationResult;
  designLoad: DesignLoad;
  /** PV panels placed, and the production per roof plane. */
  layout: PanelLayout;
  planes: PlaneEnergy[];
  /** 12 entries, January first. */
  months: MonthResult[];
  /** 12 typical days (weighted over the day types), January first. */
  days: DayProfile[];
  totals: EnergyTotals;
  economics: Economics;
  warnings: EnergyWarning[];
}

/**
 * The whole calculation. Sanitises the inputs first (`sanitizeInputs`, so garbage cannot produce NaN), then: envelope and
 * ventilation, PV layout and per-plane yields, monthly heating demand by EN ISO 13790 (solar gains through each glazed opening
 * from `climate.vertical[opening.dir]` with frame share, g, correction, roof-overhang shading, blinds; internal gains), DHW,
 * electricity by purpose with the COP of the month, hourly dispatch of the four day types with the battery, totals and
 * economics (a second dispatch without the battery gives the split). Guarantees (tested):
 *   - Σ months = totals; import = consumption - self-use; production = self-use + export + battery losses, where
 *     self-use = direct use + discharge of the battery and the battery losses are batteryIn - batteryOut (zero without a battery);
 *   - monotone: more panels never lower the production, a bigger battery never lowers self-use, a lower set-point never raises
 *     the heating demand, better insulation (lower U) never raises it;
 *   - with zero panels there is no production, no investment, `payback` is null and `status` is "none".
 */
export function computeEnergy(rawInputs: EnergyInputs, ctx: EnergyContext): EnergyResult {
  const inputs = sanitizeInputs(rawInputs, ctx);
  const prep = prepare(ctx);
  const { house, assumptions: a, climate } = ctx;
  const heating = house.equipment.heating;
  const envelope = prep.envelope;
  const ventilation = computeVentilation(inputs, ctx);
  const designLoad = computeDesignLoad(inputs, ctx);

  // ---- photovoltaics: where the panels are and what each plane yields
  const batteryOption = house.equipment.battery.options.find((o) => o.id === inputs.pv.batteryId) ?? house.equipment.battery.options[0];
  const layout = layoutPanels(ctx.planes, house.equipment.pv, { count: inputs.pv.panelCount, enabledPlanes: inputs.pv.enabledPlanes, obstacles: ctx.obstacles });
  const planes: PlaneEnergy[] = layout.planes.map((pl) => {
    const y = prep.yields.get(pl.key) as PlaneYield;
    const monthlyKwh = y.monthly.map((v) => v * pl.kwp);
    const yearlyKwh = sum(monthlyKwh);
    return { planeKey: pl.key, side: pl.side, kwp: pl.kwp, monthlyKwh, yearlyKwh, specificYield: y.yearly, basis: y.basis, exact: y.exact };
  });
  const placed = planes.filter((p) => p.kwp > 0);

  // ---- heat demand by month (EN ISO 13790, monthly method)
  const tIn = inputs.indoorTempC;
  const hAir = prep.hTransmissionAir + ventilation.hV;
  const hTotal = hAir + prep.hFloor;
  const phiInternalW = inputs.persons * a.gains.personW + (a.gains.applianceHeatShare * inputs.appliancesKwhYear * 1000) / HOURS_PER_YEAR;
  const tauHours = hTotal > 0 ? (a.thermal.internalHeatCapacityKjPerM2K * 1000 * envelope.heatedFloorArea) / (hTotal * SECONDS_PER_HOUR) : 0;
  const aFactor = 1 + tauHours / a.thermal.utilisationReferenceTimeH;
  const dhwKwhPerDay = (inputs.persons * inputs.dhwLitresPerPersonDay * WATER_WH_PER_LITRE_K * (heating.dhw.setpointC - a.dhw.coldWaterC) * (1 + a.dhw.lossShare)) / 1000;

  interface Heat { lossKwh: number; solarKwh: number; internalKwh: number; gamma: number | null; utilisation: number; needKwh: number }
  const heat: Heat[] = DAYS_IN_MONTH.map((days, m) => {
    const hours = days * 24;
    const lossKwh = Math.max(0, (hAir * (tIn - prep.monthMeanC[m]) + prep.hFloor * (tIn - prep.yearMeanC) + prep.hPeriodic * (prep.yearMeanC - prep.monthMeanC[m])) * hours / 1000);
    const internalKwh = (phiInternalW * hours) / 1000;
    const solarKwh = prep.solarGainKwh[m];
    const gains = internalKwh + solarKwh;
    if (!(lossKwh > 0)) return { lossKwh: 0, solarKwh, internalKwh, gamma: null, utilisation: 0, needKwh: 0 };
    const gamma = gains / lossKwh;
    const utilisation = utilisationFactor(gamma, aFactor);
    return { lossKwh, solarKwh, internalKwh, gamma, utilisation, needKwh: Math.max(0, lossKwh - utilisation * gains) };
  });

  // ---- heat pump: COP by month from the Carnot ratio, efficiency solved so that the seasonal COP is exactly the input
  const cop = a.heating.copCurve;
  const carnot = (sinkC: number, sourceC: number): number => {
    const sink = sinkC + cop.sinkApproachK + KELVIN, source = sourceC - cop.sourceApproachK + KELVIN;
    return sink / Math.max(1, sink - source);
  };
  const carnotHeat = prep.monthMeanC.map((t) => carnot(heating.flowTemperatureC, t));
  const carnotDhw = prep.monthMeanC.map((t) => carnot(heating.dhw.setpointC, t));
  const deliveredHeat = heat.map((h) => h.needKwh * (1 + a.heating.distributionLossShare));
  const dhwHeat = DAYS_IN_MONTH.map((days) => dhwKwhPerDay * days);
  const etaHeat = seasonalEfficiency(deliveredHeat, carnotHeat, inputs.scop);
  const etaDhw = seasonalEfficiency(dhwHeat, carnotDhw, inputs.scopDhw);
  const elHeat = deliveredHeat.map((q, m) => (q > 0 ? q / (etaHeat * carnotHeat[m]) : 0));
  const elDhw = dhwHeat.map((q, m) => (q > 0 ? q / (etaDhw * carnotDhw[m]) : 0));
  const elApp = DAYS_IN_MONTH.map((d) => (inputs.appliancesKwhYear * d) / DAYS_PER_YEAR);
  const elEv = DAYS_IN_MONTH.map((d) => (inputs.evKmYear * a.ev.kwhPerKm * (1 + a.ev.chargingLossShare) * d) / DAYS_PER_YEAR);
  const elVent = DAYS_IN_MONTH.map((d) => (ventilation.fanW * 24 * d) / 1000);

  // ---- hourly balance of the typical days of each month
  const types = normalisedDayTypes(a.pv.dayTypes);
  const usableKwh = batteryOption.capacityKwh * a.battery.usableShare;
  const battery: BatteryModel = { usableKwh, powerKw: batteryOption.powerKw, roundTripEfficiency: a.battery.roundTripEfficiency };
  const noBattery: BatteryModel = { usableKwh: 0, powerKw: 0, roundTripEfficiency: a.battery.roundTripEfficiency };
  const clipKw = a.pv.inverterClipping ? house.equipment.pv.inverter.ratedKw : undefined;
  const dhwHours = inputs.dhwDaytime ? a.dhw.daytimeHours : a.dhw.defaultHours;
  const evHours = inputs.evChargeDaytime ? a.profiles.evDaytimeHours : a.profiles.evNightHours;
  const applianceShape = normalise(a.profiles.appliances);
  const hasBattery = usableKwh > 0 && layout.kwp > 0;

  const days: DayProfile[] = [];
  const months: MonthResult[] = [];
  const split = { importKwh: 0, exportKwh: 0 }; // the same year without the battery
  for (let m = 0; m < 12; m++) {
    const n = DAYS_IN_MONTH[m];
    const mix = prep.offsets[m];
    const tLocal = toLocalHours(climate.tempUTC[m], mix);
    const degreeHours = tLocal.map((t) => Math.max(0, tIn - t));
    const dhSum = sum(degreeHours);
    const heatShape = degreeHours.map((d) => a.profiles.heatingBaseShare / 24 + (dhSum > 0 ? ((1 - a.profiles.heatingBaseShare) * d) / dhSum : (1 - a.profiles.heatingBaseShare) / 24));
    const parts: DayLoadParts = {
      heat: heatShape.map((f) => (f * elHeat[m]) / n),
      dhw: hoursShape(dhwHours).map((f) => (f * elDhw[m]) / n),
      appliances: applianceShape.map((f) => (f * elApp[m]) / n),
      ev: hoursShape(evHours).map((f) => (f * elEv[m]) / n),
      ventilation: new Array<number>(24).fill(elVent[m] / n / 24),
    };
    const load = parts.heat.map((v, h) => v + parts.dhw[h] + parts.appliances[h] + parts.ev[h] + parts.ventilation[h]);
    const pvDay = new Array<number>(24).fill(0);
    for (const pe of placed) {
      const y = prep.yields.get(pe.planeKey) as PlaneYield;
      const shape = normalise(toLocalHours(y.profileUTC[m], mix));
      for (let h = 0; h < 24; h++) pvDay[h] += (pe.monthlyKwh[m] / n) * shape[h];
    }
    const run = (b: BatteryModel): DayTypeProfile[] =>
      types.map((t) => ({ ...simulateDay(pvDay.map((v) => v * t.factor), load, b, clipKw), key: t.key, weight: t.weight, pvFactor: t.factor }));
    const typeProfiles = run(battery);
    const mean = weightedMean(typeProfiles);
    days.push({ ...mean, month: m, parts, types: typeProfiles });
    if (hasBattery) {
      const alone = weightedMean(run(noBattery));
      split.importKwh += n * sum(alone.fromGrid);
      split.exportKwh += n * sum(alone.toGrid);
    }
    const pvKwh = n * sum(mean.pv);
    const selfUse = n * (sum(mean.direct) + sum(mean.fromBattery));
    const elTotal = elHeat[m] + elDhw[m] + elApp[m] + elEv[m] + elVent[m];
    months.push({
      month: m,
      days: n,
      outdoorC: prep.monthMeanC[m],
      lossKwh: heat[m].lossKwh,
      solarGainKwh: heat[m].solarKwh,
      internalGainKwh: heat[m].internalKwh,
      gamma: heat[m].gamma,
      utilisation: heat[m].utilisation,
      heatNeedKwh: heat[m].needKwh,
      dhwHeatKwh: dhwHeat[m],
      copHeat: heat[m].needKwh > 0 ? etaHeat * carnotHeat[m] : null,
      elHeatKwh: elHeat[m],
      elDhwKwh: elDhw[m],
      elApplianceKwh: elApp[m],
      elEvKwh: elEv[m],
      elVentKwh: elVent[m],
      elTotalKwh: elTotal,
      pvKwh,
      selfUseKwh: selfUse,
      exportKwh: n * sum(mean.toGrid),
      importKwh: n * sum(mean.fromGrid),
      batteryInKwh: n * sum(mean.toBattery),
      batteryOutKwh: n * sum(mean.fromBattery),
    });
  }

  // ---- totals
  const col = (f: (m: MonthResult) => number): number => months.reduce((s, m) => s + f(m), 0);
  const heatNeed = col((m) => m.heatNeedKwh);
  const elHeatTotal = col((m) => m.elHeatKwh);
  const pvKwh = col((m) => m.pvKwh);
  const selfUse = col((m) => m.selfUseKwh);
  const elTotal = col((m) => m.elTotalKwh);
  const batteryIn = col((m) => m.batteryInKwh);
  const totals: EnergyTotals = {
    heatNeedKwh: heatNeed,
    specificHeatNeed: envelope.heatedFloorArea > 0 ? heatNeed / envelope.heatedFloorArea : 0,
    dhwHeatKwh: col((m) => m.dhwHeatKwh),
    elHeatKwh: elHeatTotal,
    elDhwKwh: col((m) => m.elDhwKwh),
    elApplianceKwh: col((m) => m.elApplianceKwh),
    elEvKwh: col((m) => m.elEvKwh),
    elVentKwh: col((m) => m.elVentKwh),
    elTotalKwh: elTotal,
    heatPumpSeasonalCop: elHeatTotal > 0 ? sum(deliveredHeat) / elHeatTotal : null,
    kwp: layout.kwp,
    pvKwh,
    pvSpecificYield: layout.kwp > 0 ? pvKwh / layout.kwp : null,
    selfUseKwh: selfUse,
    exportKwh: col((m) => m.exportKwh),
    importKwh: col((m) => m.importKwh),
    selfSufficiency: elTotal > 0 ? selfUse / elTotal : 0,
    selfConsumption: pvKwh > 0 ? selfUse / pvKwh : 0,
    batteryCycles: usableKwh > 0 ? (batteryIn * Math.sqrt(a.battery.roundTripEfficiency)) / usableKwh : 0,
  };

  // ---- economics
  const economics = computeEconomics(inputs, ctx, layout, batteryOption.capacityKwh, totals, hasBattery ? split : { importKwh: totals.importKwh, exportKwh: totals.exportKwh });

  // ---- warnings
  const warnings: EnergyWarning[] = [];
  if (checkClimate(house, ctx.derived, climate).length > 0) warnings.push({ key: "climateMismatch" });
  const planesEnabled = layout.planes.some((p) => p.enabled);
  if (layout.clamped && planesEnabled) warnings.push({ key: "panelsClamped", value: layout.capacity });
  if (!planesEnabled) warnings.push({ key: "noPlanesEnabled" });
  if (designLoad.totalW > 0 && designLoad.coverage < 1) warnings.push({ key: "heatPumpUndersized", value: designLoad.coverage });
  if (batteryOption.capacityKwh > 0 && layout.kwp <= 0) warnings.push({ key: "batteryWithoutPv" });
  if (NUMERIC_INPUT_KEYS.some((k) => rawInputs[k] !== inputs[k])) warnings.push({ key: "inputsClamped" });

  return { inputs, envelope: copyEnvelope(envelope), ventilation, designLoad, layout, planes, months, days, totals, economics, warnings };
}

// ------------------------------------------------------------------------------------------------ helpers of computeEnergy

const HOURS_PER_YEAR = 8760;
const SECONDS_PER_HOUR = 3600;
const DAYS_PER_YEAR = 365;
const KELVIN = 273.15;
/** Heat capacity of water, Wh per litre and kelvin (4.186 kJ/(kg K), 1 kg per litre). */
const WATER_WH_PER_LITRE_K = 4.186 / 3.6;

const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0);

function normalise(xs: readonly number[]): number[] {
  const total = sum(xs);
  return total > 0 ? xs.map((v) => v / total) : xs.map(() => 0);
}

/** Equal shares over the given hours of the day, 24 values. */
function hoursShape(hours: readonly number[]): number[] {
  const unique = [...new Set(hours)];
  const out = new Array<number>(24).fill(0);
  for (const h of unique) out[h] = 1 / unique.length;
  return out;
}

/**
 * The efficiency factor eta of the heat pump (COP = eta x Carnot ratio of the month) for which the seasonal COP, delivered heat
 * divided by electricity, equals `seasonalCop` exactly: eta = SCOP x sum(Q / carnot) / sum(Q). 1 when nothing is delivered.
 */
function seasonalEfficiency(heat: readonly number[], carnot: readonly number[], seasonalCop: number): number {
  const total = sum(heat);
  if (!(total > 0)) return 1;
  return (seasonalCop * sum(heat.map((q, m) => q / carnot[m]))) / total;
}

/** Hourly UTC series to the wall clock of the month: hour h of the day takes the value at h - offset (linear between hours), mixed over the offsets of the month. */
function toLocalHours(utc: readonly number[], mix: readonly { offset: number; share: number }[]): number[] {
  const out = new Array<number>(24).fill(0);
  const at = (i: number): number => utc[((i % 24) + 24) % 24];
  for (const { offset, share } of mix) {
    for (let h = 0; h < 24; h++) {
      const x = h - offset;
      const i0 = Math.floor(x);
      const f = x - i0;
      out[h] += share * ((1 - f) * at(i0) + f * at(i0 + 1));
    }
  }
  return out;
}

/** The day types with weights summing to exactly 1 and a weighted mean factor of exactly 1 (the file is checked to 1 % only). */
function normalisedDayTypes(types: Assumptions["pv"]["dayTypes"]): { key: DayTypeKey; weight: number; factor: number }[] {
  const w = sum(types.map((t) => t.weight));
  const mean = sum(types.map((t) => t.weight * t.factor)) / w;
  return types.map((t) => ({ key: t.key, weight: t.weight / w, factor: t.factor / mean }));
}

/** Weighted mean of day profiles (all arrays of the flows). */
function weightedMean(types: readonly DayTypeProfile[]): DayFlows {
  const mean = (pick: (t: DayTypeProfile) => Hourly): Hourly => types[0].load.map((_, h) => types.reduce((s, t) => s + t.weight * pick(t)[h], 0));
  return {
    load: mean((t) => t.load),
    pv: mean((t) => t.pv),
    direct: mean((t) => t.direct),
    toBattery: mean((t) => t.toBattery),
    fromBattery: mean((t) => t.fromBattery),
    toGrid: mean((t) => t.toGrid),
    fromGrid: mean((t) => t.fromGrid),
    soc: mean((t) => t.soc),
  };
}

/** Investment, savings and payback; the year without the battery (`alone`) gives the split between PV and battery. */
function computeEconomics(
  inputs: EnergyInputs,
  ctx: EnergyContext,
  layout: PanelLayout,
  batteryKwh: number,
  totals: EnergyTotals,
  alone: { importKwh: number; exportKwh: number },
): Economics {
  const cap = ctx.assumptions.economy.paybackCapYears;
  const buy = inputs.priceBuy, sell = inputs.priceSell;
  // the fixed charges of the connection are paid either way: they raise both costs and leave the saving as it is
  const fixed = ctx.assumptions.economy.fixedChargesPerYear;
  const costWithoutPv = totals.elTotalKwh * buy + fixed;
  const costWithPv = totals.importKwh * buy - totals.exportKwh * sell + fixed;
  const savings = costWithoutPv - costWithPv;
  const savingsPvOnly = costWithoutPv - (alone.importKwh * buy - alone.exportKwh * sell + fixed);

  const grossPv = layout.kwp > 0 ? layout.kwp * Math.max(0, inputs.pvPricePerKwp) : 0;
  const grossBattery = layout.kwp > 0 ? batteryKwh * Math.max(0, inputs.batteryPricePerKwh) : 0;
  const investmentGross = grossPv + grossBattery;
  const subsidy = Math.min(investmentGross, Math.max(0, inputs.subsidy));
  const investment = investmentGross - subsidy;
  // the subsidy is shared between PV and battery in proportion to their prices
  const part = (gross: number, saved: number): PaybackPart => {
    const own = investmentGross > 0 ? gross - subsidy * (gross / investmentGross) : 0;
    return { savings: saved, investment: own, ...payback(own, saved, gross, cap) };
  };
  return {
    costWithoutPv,
    costWithPv,
    savings,
    investmentGross,
    investment,
    ...payback(investment, savings, investmentGross, cap),
    pvOnly: part(grossPv, grossBattery > 0 ? savingsPvOnly : savings),
    battery: part(grossBattery, grossBattery > 0 ? savings - savingsPvOnly : 0),
  };
}

/** Simple payback in years and its status: "none" when nothing is paid, "never" when savings are not positive or the payback exceeds the cap. */
function payback(investment: number, savings: number, gross: number, capYears: number): { paybackYears: number | null; status: PaybackStatus } {
  if (!(gross > 0) || !(investment > 0)) return { paybackYears: null, status: "none" };
  if (!(savings > 0)) return { paybackYears: null, status: "never" };
  const years = investment / savings;
  return years > capYears ? { paybackYears: null, status: "never" } : { paybackYears: years, status: "ok" };
}
