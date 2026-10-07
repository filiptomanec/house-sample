// Plot statistics: built-up area, paved surfaces, green area, slope classes, cut and fill.
import { bboxOf, pointInPolygon, polygonArea, rectToPolygon, unionArea, type Rect, type XY } from "./geometry";
import type { Terrain } from "./terrain";

/** Outdoor area as in `house.json` (concept/1 `outdoor[]`): a rectangle or polygon in the house frame. */
export interface OutdoorInput {
  type: string;
  covered?: boolean;
  rect?: Rect;
  polygon?: XY[];
}

/** Site-level hard surface that is not part of the house model (apron, garden path, bin pad). */
export interface PavedInput {
  kind: string;
  polygon: XY[];
}

/** Outdoor types that are hard surfaces. Types outside this list (lawn, planting) count as green. */
export const HARD_OUTDOOR_TYPES: readonly string[] = ["terrace", "paving", "drive", "path"];

export const outdoorPolygon = (o: OutdoorInput): XY[] => (o.polygon ? o.polygon : o.rect ? rectToPolygon(o.rect) : []);

export interface PlotStats {
  /** Plot area (m2), shoelace. */
  plotArea: number;
  /** House outline inside the plot (m2). */
  footprintArea: number;
  /** Roofed outdoor areas outside the outline (covered terrace, porch), counted once (m2). */
  coveredOutdoorArea: number;
  /** Built-up area = footprint + roofed outdoor areas (m2). */
  builtUpArea: number;
  builtUpRatio: number;
  /** Uncovered hard surfaces inside the plot, without overlaps and without built-up area (m2). */
  pavedArea: number;
  pavedRatio: number;
  /** Plot minus built-up minus paved (m2). */
  greenArea: number;
  greenRatio: number;
  /** (built-up + paved) / plot. */
  imperviousRatio: number;
  /** Area inside the plot per outdoor type and per site paved kind (each key de-overlapped on its own, m2). */
  byOutdoorType: Record<string, number>;
  byPavedKind: Record<string, number>;
}

/**
 * Areas of the plot. All shapes are clipped to the plot and overlaps are counted once, so the result
 * satisfies built-up + paved + green = plot area exactly.
 */
export function plotStats(plot: readonly XY[], footprint: readonly XY[], outdoor: readonly OutdoorInput[], paved: readonly PavedInput[] = []): PlotStats {
  const plotArea = polygonArea(plot);
  const covered = outdoor.filter((o) => o.covered).map(outdoorPolygon);
  const hard = [
    ...outdoor.filter((o) => !o.covered && HARD_OUTDOOR_TYPES.includes(o.type)).map(outdoorPolygon),
    ...paved.map((p) => p.polygon),
  ];
  const footprintArea = unionArea([footprint], plot);
  const builtUpArea = unionArea([footprint, ...covered], plot);
  const impervious = unionArea([footprint, ...covered, ...hard], plot);
  const pavedArea = impervious - builtUpArea;
  const greenArea = plotArea - impervious;
  const byOutdoorType: Record<string, number> = {};
  for (const type of new Set(outdoor.map((o) => o.type))) {
    byOutdoorType[type] = unionArea(outdoor.filter((o) => o.type === type).map(outdoorPolygon), plot);
  }
  const byPavedKind: Record<string, number> = {};
  for (const kind of new Set(paved.map((p) => p.kind))) {
    byPavedKind[kind] = unionArea(paved.filter((p) => p.kind === kind).map((p) => p.polygon), plot);
  }
  return {
    plotArea, footprintArea,
    coveredOutdoorArea: builtUpArea - footprintArea,
    builtUpArea, builtUpRatio: builtUpArea / plotArea,
    pavedArea, pavedRatio: pavedArea / plotArea,
    greenArea, greenRatio: greenArea / plotArea,
    imperviousRatio: impervious / plotArea,
    byOutdoorType, byPavedKind,
  };
}

// ---------------------------------------------------------------------------------------------

export interface SlopeClass {
  /** Lower bound (inclusive) and upper bound (exclusive) in percent. */
  fromPct: number;
  toPct: number;
  area: number;
  ratio: number;
}

export interface SlopeStats {
  /** Sampled area (m2) and sample spacing. */
  area: number;
  samples: number;
  step: number;
  zMin: number;
  zMax: number;
  zMean: number;
  slopeMeanPct: number;
  slopeMaxPct: number;
  slopeP95Pct: number;
  /** Area-weighted mean downhill direction relative to true north (degrees), from the mean gradient vector. */
  meanDownhillTrueAzimuth: number;
  classes: SlopeClass[];
}

/** Class limits (%) used when none are given: flat, gentle, moderate, steep. */
export const DEFAULT_SLOPE_LIMITS: readonly number[] = [0, 2, 5, 10, Infinity];

/** Height and slope statistics of the graded terrain inside a polygon, sampled on a regular grid. */
export function slopeStats(terrain: Terrain, polygon: readonly XY[], opts: { step?: number; limits?: readonly number[] } = {}): SlopeStats {
  const step = opts.step ?? 1;
  const limits = opts.limits ?? DEFAULT_SLOPE_LIMITS;
  const b = bboxOf(polygon);
  const slopes: number[] = [];
  let zMin = Infinity, zMax = -Infinity, zSum = 0, gxSum = 0, gySum = 0;
  for (let y = b.y0 + step / 2; y < b.y1; y += step) {
    for (let x = b.x0 + step / 2; x < b.x1; x += step) {
      if (!pointInPolygon([x, y], polygon)) continue;
      const z = terrain.groundAt(x, y);
      const s = terrain.slopeAt(x, y);
      slopes.push(s.slopePct);
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
      zSum += z;
      gxSum += s.gx;
      gySum += s.gy;
    }
  }
  const n = slopes.length;
  if (!n) throw new Error("slopeStats: polygon contains no sample points");
  const sorted = [...slopes].sort((p, q) => p - q);
  const cell = step * step;
  const classes: SlopeClass[] = [];
  for (let k = 0; k + 1 < limits.length; k++) {
    const count = slopes.filter((s) => s >= limits[k] && s < limits[k + 1]).length;
    classes.push({ fromPct: limits[k], toPct: limits[k + 1], area: count * cell, ratio: count / n });
  }
  const downhill = Math.atan2(-gxSum, -gySum); // azimuth of the mean fall line in the house frame (from +y)
  return {
    area: n * cell, samples: n, step,
    zMin, zMax, zMean: zSum / n,
    slopeMeanPct: slopes.reduce((s, v) => s + v, 0) / n,
    slopeMaxPct: sorted[n - 1],
    slopeP95Pct: sorted[Math.min(n - 1, Math.floor(0.95 * n))],
    meanDownhillTrueAzimuth: (((downhill * 180) / Math.PI + terrain.bearingDeg) % 360 + 360) % 360,
    classes,
  };
}

export interface CutFill {
  /** Volumes in m3 (>= 0). Fill = graded above natural ground, cut = graded below. */
  cut: number;
  fill: number;
  /** fill - cut: positive means soil must be brought in. */
  net: number;
  /** Area where grading changes the ground by more than 1 cm (m2). */
  gradedArea: number;
  maxCut: number;
  maxFill: number;
}

/** Earthworks volume between natural and graded ground inside a polygon (midpoint rule). */
export function cutFillVolume(terrain: Terrain, polygon: readonly XY[], step = 0.5): CutFill {
  const b = bboxOf(polygon);
  let cut = 0, fill = 0, area = 0, maxCut = 0, maxFill = 0;
  const cell = step * step;
  for (let y = b.y0 + step / 2; y < b.y1; y += step) {
    for (let x = b.x0 + step / 2; x < b.x1; x += step) {
      if (!pointInPolygon([x, y], polygon)) continue;
      const dz = terrain.groundAt(x, y) - terrain.naturalAt(x, y);
      if (dz > 0) { fill += dz * cell; maxFill = Math.max(maxFill, dz); }
      else { cut -= dz * cell; maxCut = Math.max(maxCut, -dz); }
      if (Math.abs(dz) > 0.01) area += cell;
    }
  }
  return { cut, fill, net: fill - cut, gradedArea: area, maxCut, maxFill };
}
