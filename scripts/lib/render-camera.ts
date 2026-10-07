// Camera maths for the render inputs: field of view from a focal length, the resolved camera object written to
// render-inputs.json, and projection of 3D points to the image (used for "is the sun in frame" and the orbit fit).
// Pure TypeScript. House frame (x east, y north, z up); the sensor convention is Blender's `sensor_fit = AUTO`:
// the sensor width applies to the LONGER image side.
import type { CameraSpec, Vec2, Vec3 } from "./render-schema";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

export interface Fov {
  horizontalDeg: number;
  verticalDeg: number;
}

/** Field of view of an image of `size` pixels for a focal length on a sensor of `sensorWidthMm` along the longer side. */
export function fieldOfView(focalMm: number, sensorWidthMm: number, size: readonly [number, number]): Fov {
  const [w, h] = size;
  const longTan = sensorWidthMm / (2 * focalMm);
  const tanH = w >= h ? longTan : longTan * (w / h);
  const tanV = w >= h ? longTan * (h / w) : longTan;
  return { horizontalDeg: 2 * Math.atan(tanH) * DEG, verticalDeg: 2 * Math.atan(tanV) * DEG };
}

export interface ResolvedCamera {
  position: Vec3;
  target: Vec3;
  forward: Vec3;
  up: Vec3;
  roll: number;
  focalMm: number;
  sensorWidthMm: number;
  shift: Vec2;
  near: number;
  far: number;
  fov: Fov;
}

export interface CameraDefaults {
  sensorWidthMm: number;
  near: number;
  far: number;
}

/** Resolves a camera spec of render.json into the object written to the output (forward vector, fov, defaults). */
export function resolveCamera(spec: CameraSpec, size: readonly [number, number], d: CameraDefaults): ResolvedCamera {
  const forward = norm(sub(spec.target, spec.position));
  if (len(forward) === 0) throw new Error("camera position equals its target");
  return {
    position: spec.position,
    target: spec.target,
    forward,
    up: [0, 0, 1],
    roll: spec.roll ?? 0,
    focalMm: spec.focalMm,
    sensorWidthMm: d.sensorWidthMm,
    shift: spec.shift ?? [0, 0],
    near: d.near,
    far: d.far,
    fov: fieldOfView(spec.focalMm, d.sensorWidthMm, size),
  };
}

export interface Projected {
  /** Normalised device coordinates: x right, y up, both -1..1 inside the frame. */
  x: number;
  y: number;
  /** Distance along the viewing axis (m). Positive in front of the camera. */
  depth: number;
}

/** Projects a point (or a direction at infinity when `atInfinity`) to the image. Null when behind the camera. */
export function project(cam: ResolvedCamera, size: readonly [number, number], p: Vec3, atInfinity = false): Projected | null {
  const f = cam.forward;
  const right = norm(cross(f, cam.up));
  const upv = cross(right, f);
  let rx = right, ux = upv;
  if (cam.roll) {
    const c = Math.cos(cam.roll * RAD), s = Math.sin(cam.roll * RAD);
    rx = add(scale(right, c), scale(upv, s));
    ux = add(scale(upv, c), scale(right, -s));
  }
  const d = atInfinity ? p : sub(p, cam.position);
  const z = dot(d, f);
  if (z <= 1e-6) return null;
  const [w, h] = size;
  const longTan = cam.sensorWidthMm / (2 * cam.focalMm);
  // normalised along the longer side: +-1 at its edges
  const u = dot(d, rx) / z / longTan;
  const v = dot(d, ux) / z / longTan;
  const L = Math.max(w, h);
  // Blender's shift is a fraction of the longer side; one unit of ndc along the longer side is half of it
  const nx = u - 2 * cam.shift[0];
  const ny = v - 2 * cam.shift[1];
  return { x: (nx * L) / w, y: (ny * L) / h, depth: z };
}

/** True when the projected point lies inside the frame shrunk by `margin` (fraction of the half size). */
export const insideFrame = (p: Projected | null, margin = 0): boolean =>
  p !== null && Math.abs(p.x) <= 1 - margin && Math.abs(p.y) <= 1 - margin;

/** The eight corners of an axis-aligned box. */
export function boxCorners(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
}
