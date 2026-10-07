// Camera arithmetic of the viewer that needs no three.js: stepping the orbit camera around its target with the keyboard,
// zooming, and the easing of view transitions. Pure, so it is tested in node.
import type { Vec3 } from "./frame";

/** Polar angle (from +Y) and azimuth (about +Y, `atan2(x, z)`) of an offset from the orbit target, as in three's `Spherical`. */
export function toSpherical([x, y, z]: Readonly<Vec3>): { radius: number; phi: number; theta: number } {
  const radius = Math.hypot(x, y, z);
  return { radius, phi: radius > 0 ? Math.acos(Math.max(-1, Math.min(1, y / radius))) : 0, theta: Math.atan2(x, z) };
}

export function fromSpherical(radius: number, phi: number, theta: number): Vec3 {
  const s = radius * Math.sin(phi);
  return [s * Math.sin(theta), radius * Math.cos(phi), s * Math.cos(theta)];
}

/** Smallest polar angle the keyboard orbit goes to (a hair from the pole, where the view would flip). */
export const MIN_POLAR = 0.01;

/**
 * The camera offset after turning `dTheta` about the vertical and `dPhi` away from the pole (both radians). The distance is
 * kept; the polar angle stays between `MIN_POLAR` and `maxPolar` (the camera never goes below the ground).
 */
export function orbitOffset(offset: Readonly<Vec3>, dTheta: number, dPhi: number, maxPolar: number): Vec3 {
  const s = toSpherical(offset);
  const phi = Math.max(MIN_POLAR, Math.min(maxPolar, s.phi + dPhi));
  return fromSpherical(s.radius, phi, s.theta + dTheta);
}

/** The camera offset scaled by `factor` and clamped to the allowed distance. */
export function zoomOffset(offset: Readonly<Vec3>, factor: number, min: number, max: number): Vec3 {
  const len = Math.hypot(...offset);
  if (len === 0) return [...offset];
  const target = Math.max(min, Math.min(max, len * factor));
  return [offset[0] * (target / len), offset[1] * (target / len), offset[2] * (target / len)];
}

/** Smooth start and end (zero slope at both) for camera transitions, 0..1 to 0..1. */
export const easeInOut = (t: number): number => t * t * (3 - 2 * t);
