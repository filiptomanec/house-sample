// Distances of the house (and roofs) from the plot boundary, per side of the house frame and per true compass side.
import { azimuthOf, edgeOutwardNormal, ensureCcw, houseToTrueAzimuth, pointInPolygon, segmentSegmentClosest, type XY } from "./geometry";

export type Side = "N" | "E" | "S" | "W";
export const SIDES: readonly Side[] = ["N", "E", "S", "W"];

export interface Setback {
  /** Side the boundary edge belongs to (set when the edge is assigned to a side). */
  side?: Side;
  /** Shortest distance (m) from the house to the boundary edge. */
  d: number;
  /** Closest point on the house outline. */
  from: XY;
  /** Closest point on the boundary. */
  to: XY;
  /** Index of the plot edge (vertex i -> i + 1 of the counter-clockwise plot). */
  edge: number;
}

export interface SetbackSet {
  /** Sides of the house frame: N = +y, E = +x. */
  house: Partial<Record<Side, Setback>>;
  /** Sides relative to true north (the house axis is rotated by `bearingDeg`). */
  trueNorth: Partial<Record<Side, Setback>>;
  /** Nearest approach to each plot edge, in edge order. */
  perEdge: Setback[];
  /** Nearest approach overall. */
  min: Setback;
  /** Nearest approach per edge kind ("street", "neighbour", ...) when `edgeKinds` is given. */
  byEdgeKind: Record<string, Setback>;
  /** True when every house vertex lies inside the plot. */
  inside: boolean;
}

export interface SetbackOptions {
  /** Azimuth of the house +y axis from true north (degrees). Default 0. */
  bearingDeg?: number;
  /** Kind of each plot edge, aligned with the counter-clockwise plot (see `plot.edges[].kind`). */
  edgeKinds?: readonly string[];
  /** An edge belongs to a side only when its outward normal is within this angle of the side (default 30 degrees). */
  toleranceDeg?: number;
}

const sideOfAzimuth = (az: number, tolerance: number): Side | undefined => {
  const k = Math.round(az / 90);
  return Math.abs(az - k * 90) <= tolerance ? SIDES[((k % 4) + 4) % 4] : undefined;
};

/**
 * Shortest distance of the house outline to each boundary edge, assigned to sides by the outward normal
 * of the edge, both in the house frame and relative to true north.
 * Oblique pieces (normal further than the tolerance from every side) take part in `min` only.
 * The plot may be given in either winding; the house outline in any winding.
 */
export function houseSetbacks(footprint: readonly XY[], plot: readonly XY[], opts: SetbackOptions = {}): SetbackSet {
  const bearing = opts.bearingDeg ?? 0;
  const tol = opts.toleranceDeg ?? 30;
  const poly = ensureCcw(plot);
  const reversed = poly[0] !== plot[0] || poly[1] !== plot[1];
  const n = poly.length;
  // A clockwise input is reversed: reversed edge i is original edge (n - 2 - i) walked backwards.
  const kinds = opts.edgeKinds ? poly.map((_, i) => opts.edgeKinds?.[reversed ? (n - 2 - i + n) % n : i]) : undefined;
  const perEdge: Setback[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    let best: Setback | undefined;
    for (let k = 0; k < footprint.length; k++) {
      const c = segmentSegmentClosest(footprint[k], footprint[(k + 1) % footprint.length], a, b);
      if (!best || c.d < best.d) best = { d: c.d, from: c.from, to: c.to, edge: i };
    }
    perEdge.push(best as Setback);
  }
  const house: SetbackSet["house"] = {};
  const trueNorth: SetbackSet["trueNorth"] = {};
  const byEdgeKind: Record<string, Setback> = {};
  perEdge.forEach((s, i) => {
    const az = azimuthOf(edgeOutwardNormal(poly, i));
    const hs = sideOfAzimuth(az, tol);
    const ts = sideOfAzimuth(houseToTrueAzimuth(az, bearing), tol);
    if (hs && (!house[hs] || s.d < (house[hs] as Setback).d)) house[hs] = { ...s, side: hs };
    if (ts && (!trueNorth[ts] || s.d < (trueNorth[ts] as Setback).d)) trueNorth[ts] = { ...s, side: ts };
    const kind = kinds?.[i];
    if (kind && (!byEdgeKind[kind] || s.d < byEdgeKind[kind].d)) byEdgeKind[kind] = s;
  });
  const min = perEdge.reduce((m, s) => (s.d < m.d ? s : m), perEdge[0]);
  return { house, trueNorth, perEdge, min, byEdgeKind, inside: footprint.every((p) => pointInPolygon(p, poly)) };
}
