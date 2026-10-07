// Coordinate frames and sun geometry of the 3D engine. Pure arithmetic (no three.js), so tests and servers can use it.
//
//   house frame   x east, y north, z up, metres from the house origin, in the frame of the house axes (model/*.json, derived)
//   scene frame   the three.js world: Y-up, the house frame mapped as (x, y, z) -> (x, z, -y)  (the glTF convention)
//
// The scene is NOT rotated against true north: the house frame is the world frame. True orientation enters only through
// the bearing (`derived.houseAxisBearingDeg`): the sun direction and the compass.
import type { Pt3 } from "@/lib/model";

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/** Angle wrapped to [0, 360). */
export const mod360 = (a: number): number => ((a % 360) + 360) % 360;

/** House frame -> scene frame. */
export const toScene = ([x, y, z]: Readonly<Pt3>): Vec3 => [x, z, -y];
/** Scene frame -> house frame. */
export const fromScene = ([x, y, z]: Readonly<Vec3>): Vec3 => [x, -z, y];

/** House azimuth (clockwise from the house +y axis) of a true azimuth. */
export const houseAzimuth = (azimuthTrueDeg: number, bearingDeg: number): number => mod360(azimuthTrueDeg - bearingDeg);
/** True azimuth of a house azimuth. */
export const trueAzimuth = (houseAzimuthDeg: number, bearingDeg: number): number => mod360(houseAzimuthDeg + bearingDeg);

/**
 * Unit vector towards the sun in the HOUSE frame (x east, y north, z up) from the true azimuth (clockwise from true
 * north) and the altitude above the horizon, both in degrees. Same formula as docs/KERNEL-API.md section 4.4.
 */
export function sunDirectionHouse(azimuthTrueDeg: number, altitudeDeg: number, bearingDeg: number): Vec3 {
  const a = houseAzimuth(azimuthTrueDeg, bearingDeg) * RAD;
  const e = altitudeDeg * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** The same direction in the SCENE frame (what `DirectionalLight.position` needs). */
export function sunDirectionScene(azimuthTrueDeg: number, altitudeDeg: number, bearingDeg: number): Vec3 {
  return toScene(sunDirectionHouse(azimuthTrueDeg, altitudeDeg, bearingDeg));
}

/**
 * True heading (degrees clockwise from true north) of a horizontal viewing direction given in the SCENE frame, e.g.
 * `camera.getWorldDirection()`. Only x and z are used. A vector pointing straight up or down has no heading (returns 0).
 */
export function headingTrue(dirScene: Readonly<Vec3>, bearingDeg: number): number {
  const east = dirScene[0], north = -dirScene[2];
  if (Math.abs(east) < 1e-12 && Math.abs(north) < 1e-12) return 0;
  return trueAzimuth(Math.atan2(east, north) / RAD, bearingDeg);
}

/** Dot product of two vectors (helper for incidence and facing tests). */
export const dot3 = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Unit outward normal in the HOUSE frame (x, y) of a wall or opening from its house azimuth (0 = +y, 90 = +x).
 * `derived.openings[].azimuth` and `derived.walls[].azimuth` are exactly this.
 */
export function outwardNormalHouse(houseAzimuthDeg: number): [number, number] {
  const a = houseAzimuthDeg * RAD;
  return [Math.sin(a), Math.cos(a)];
}
