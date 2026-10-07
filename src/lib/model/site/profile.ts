// Elevation profiles and point-to-point measurements on the terrain.
import { azimuthOf, dist, houseToTrueAzimuth, rad2deg, type XY } from "./geometry";

export type GroundFn = (x: number, y: number) => number;

export interface ProfilePoint {
  /** Distance from the start (m). */
  s: number;
  x: number;
  y: number;
  z: number;
}

export interface Profile {
  points: ProfilePoint[];
  length: number;
  zMin: number;
  zMax: number;
  /** End height minus start height (m). */
  rise: number;
  /** Sum of climbs and sum of descents (m, both >= 0). */
  ascent: number;
  descent: number;
  /** Steepest 1-sample segment (%, absolute). */
  maxSlopePct: number;
  /** Mean absolute slope (%): (ascent + descent) / length. */
  meanSlopePct: number;
}

/** Heights along the straight line a -> b. Either `step` (m, default 0.5) or `count` samples (>= 2). */
export function sampleProfile(ground: GroundFn, a: XY, b: XY, opts: { step?: number; count?: number } = {}): Profile {
  const length = dist(a, b);
  const n = Math.max(2, opts.count ?? Math.ceil(length / (opts.step ?? 0.5)) + 1);
  const points: ProfilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    points.push({ s: length * t, x, y, z: ground(x, y) });
  }
  let zMin = Infinity, zMax = -Infinity, ascent = 0, descent = 0, maxSlope = 0;
  for (let i = 0; i < n; i++) {
    const z = points[i].z;
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    if (i > 0) {
      const dz = z - points[i - 1].z, ds = points[i].s - points[i - 1].s;
      if (dz > 0) ascent += dz;
      else descent -= dz;
      if (ds > 0) maxSlope = Math.max(maxSlope, (Math.abs(dz) / ds) * 100);
    }
  }
  return {
    points, length, zMin, zMax,
    rise: points[n - 1].z - points[0].z,
    ascent, descent,
    maxSlopePct: maxSlope,
    meanSlopePct: length ? ((ascent + descent) / length) * 100 : 0,
  };
}

export interface Measurement {
  from: XY;
  to: XY;
  zFrom: number;
  zTo: number;
  /** Horizontal distance (m). */
  distance: number;
  /** Distance along the sloping line (m). */
  distance3d: number;
  /** Height difference to - from (m). */
  dz: number;
  /** Mean slope between the points: signed, positive when the ground rises towards `to`. */
  slopePct: number;
  slopeDeg: number;
  /** Direction from -> to, house azimuth (clockwise from +y). */
  houseAzimuth: number;
  /** Same, relative to true north (needs the house axis bearing). */
  trueAzimuth: number;
  /** Steepest part of the straight line (%, absolute). */
  maxSlopePct: number;
}

/** Distance, height difference and slope between two points. `bearingDeg` = location.houseAxisBearingDeg. */
export function measureBetween(ground: GroundFn, from: XY, to: XY, bearingDeg: number): Measurement {
  const zFrom = ground(from[0], from[1]), zTo = ground(to[0], to[1]);
  const distance = dist(from, to);
  const dz = zTo - zFrom;
  const az = distance ? azimuthOf([to[0] - from[0], to[1] - from[1]]) : 0;
  return {
    from, to, zFrom, zTo, distance,
    distance3d: Math.hypot(distance, dz),
    dz,
    slopePct: distance ? (dz / distance) * 100 : 0,
    slopeDeg: distance ? rad2deg(Math.atan2(dz, distance)) : 0,
    houseAzimuth: az,
    trueAzimuth: houseToTrueAzimuth(az, bearingDeg),
    maxSlopePct: distance ? sampleProfile(ground, from, to, { step: 0.5 }).maxSlopePct : 0,
  };
}
