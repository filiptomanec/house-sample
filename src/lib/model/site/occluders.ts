// Shading primitives (boxes, convex solids, spheres, ellipsoids) and ray tests, house frame, z up.
// Output format for the later sun analysis: build occluders once, cast rays from sample points towards the sun.
import { deg2rad, ensureCcw, type XY } from "./geometry";

export type Vec3 = [number, number, number];

export type OccluderRole = "neighbour_wall" | "neighbour_roof" | "tree" | "shrub" | "hedge" | "fence";

/** Light extinction per metre of path inside the occluder; absent = fully opaque. */
export interface Extinction {
  /** Value in full leaf, per metre. */
  leafOn: number;
  /** Value without leaves (twigs and trunks), per metre. */
  leafOff: number;
}

interface Base {
  /** Id of the site element this primitive belongs to (labels only; never branch on it). */
  id: string;
  role: OccluderRole;
  extinction?: Extinction;
  /** Whether the element keeps its leaves in winter (affects `leafFactor`). */
  evergreen?: boolean;
}

export interface BoxOccluder extends Base { kind: "box"; min: Vec3; max: Vec3 }
/** Convex solid as intersection of half-spaces n . p <= d (n need not be unit length). */
export interface ConvexOccluder extends Base { kind: "convex"; planes: { n: Vec3; d: number }[] }
export interface SphereOccluder extends Base { kind: "sphere"; center: Vec3; radius: number }
export interface EllipsoidOccluder extends Base { kind: "ellipsoid"; center: Vec3; radii: Vec3 }
export type Occluder = BoxOccluder | ConvexOccluder | SphereOccluder | EllipsoidOccluder;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Parameter interval [tIn, tOut] where the ray origin + t * dir is inside the occluder, or null. tIn is clamped to >= 0. */
export function rayChord(o: Occluder, origin: Vec3, dir: Vec3): { tIn: number; tOut: number } | null {
  switch (o.kind) {
    case "box": {
      let tIn = 0, tOut = Infinity;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(dir[k]) < 1e-12) {
          if (origin[k] < o.min[k] || origin[k] > o.max[k]) return null;
        } else {
          let a = (o.min[k] - origin[k]) / dir[k], b = (o.max[k] - origin[k]) / dir[k];
          if (a > b) [a, b] = [b, a];
          tIn = Math.max(tIn, a);
          tOut = Math.min(tOut, b);
          if (tIn > tOut) return null;
        }
      }
      return tOut > 0 ? { tIn, tOut } : null;
    }
    case "convex": {
      let tIn = 0, tOut = Infinity;
      for (const { n, d } of o.planes) {
        const den = dot(n, dir), num = d - dot(n, origin);
        if (Math.abs(den) < 1e-12) {
          if (num < 0) return null;
        } else if (den > 0) tOut = Math.min(tOut, num / den);
        else tIn = Math.max(tIn, num / den);
        if (tIn > tOut) return null;
      }
      return tOut > 0 ? { tIn, tOut } : null;
    }
    case "sphere":
      return ellipsoidChord(o.center, [o.radius, o.radius, o.radius], origin, dir);
    case "ellipsoid":
      return ellipsoidChord(o.center, o.radii, origin, dir);
  }
}

function ellipsoidChord(c: Vec3, r: Vec3, origin: Vec3, dir: Vec3): { tIn: number; tOut: number } | null {
  // Scale space so the ellipsoid becomes a unit sphere.
  const p: Vec3 = [(origin[0] - c[0]) / r[0], (origin[1] - c[1]) / r[1], (origin[2] - c[2]) / r[2]];
  const v: Vec3 = [dir[0] / r[0], dir[1] / r[1], dir[2] / r[2]];
  const a = dot(v, v), b = 2 * dot(p, v), cc = dot(p, p) - 1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0 || a < 1e-18) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a), t1 = (-b + s) / (2 * a);
  return t1 > 0 ? { tIn: Math.max(0, t0), tOut: t1 } : null;
}

/** Distance to the first entry of the occluder along the ray (0 when the origin is inside), or null. */
export function rayIntersect(o: Occluder, origin: Vec3, dir: Vec3): number | null {
  const c = rayChord(o, origin, dir);
  return c ? c.tIn : null;
}

/**
 * Leaf factor in [0, 1] for a day of the year (1 = full leaf): leaves open between about 15 April and 15 May
 * and fall between about 5 October and 5 November (mid-latitude central Europe). Evergreens are always 1.
 */
export function leafFactor(dayOfYear: number, evergreen = false): number {
  if (evergreen) return 1;
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const open = ramp(dayOfYear, 105, 135);
  const fall = 1 - ramp(dayOfYear, 278, 308);
  const f = Math.min(open, fall);
  return f * f * (3 - 2 * f);
}

/**
 * Fraction of light that passes an occluder along one ray, in [0, 1]: 0 for opaque solids,
 * exp(-extinction * chord length) for crowns and hedges. `dayOfYear` (1-366) selects the leaf state.
 */
export function transmittanceThrough(o: Occluder, origin: Vec3, dir: Vec3, dayOfYear = 172): number {
  const chord = rayChord(o, origin, dir);
  if (!chord) return 1;
  if (!o.extinction) return 0;
  const len = (chord.tOut - chord.tIn) * Math.hypot(dir[0], dir[1], dir[2]);
  const f = leafFactor(dayOfYear, o.evergreen);
  const k = o.extinction.leafOff + (o.extinction.leafOn - o.extinction.leafOff) * f;
  return Math.exp(-k * len);
}

/** Light transmittance along a ray through all occluders (product), 1 = unobstructed. Only hits ahead of the origin count. */
export function rayTransmittance(occluders: readonly Occluder[], origin: Vec3, dir: Vec3, dayOfYear = 172): number {
  let t = 1;
  for (const o of occluders) {
    t *= transmittanceThrough(o, origin, dir, dayOfYear);
    if (t < 1e-4) return 0;
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Builders

export const boxOf = (min: Vec3, max: Vec3, base: Base): BoxOccluder => ({ ...base, kind: "box", min, max });

/** Vertical prism over a convex polygon between two heights. */
export function prismOf(polygon: readonly XY[], zMin: number, zMax: number, base: Base): ConvexOccluder {
  const p = ensureCcw(polygon);
  const planes: ConvexOccluder["planes"] = [
    { n: [0, 0, 1], d: zMax },
    { n: [0, 0, -1], d: -zMin },
  ];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l; // outward for CCW
    planes.push({ n: [nx, ny, 0], d: nx * a[0] + ny * a[1] });
  }
  return { ...base, kind: "convex", planes };
}

/** Rectangle (w along the local x axis, d along y) rotated by `rotDeg` counter-clockwise about its centre. */
export function orientedRect(center: XY, w: number, d: number, rotDeg: number): XY[] {
  const c = Math.cos(deg2rad(rotDeg)), s = Math.sin(deg2rad(rotDeg));
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as XY[]).map(([x, y]) => [center[0] + x * c - y * s, center[1] + x * s + y * c] as XY);
}

/** Thick polyline segment as a convex quad (for hedges and fences). */
export function segmentQuad(a: XY, b: XY, width: number): XY[] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / l) * (width / 2), ny = ((b[0] - a[0]) / l) * (width / 2);
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
}

export type RoofKind = "hip" | "gable" | "flat";

/**
 * Roof solid over a rotated rectangle: intersection of the bottom plane (eave height) and sloping planes.
 * `hip`: four planes of the same pitch. `gable`: two planes along the longer side (gable walls vertical).
 * `flat`: a slab of 0.2 m. Width `w` runs along the local x axis before rotation.
 */
export function roofSolid(center: XY, w: number, d: number, rotDeg: number, eaveZ: number, pitchDeg: number, kind: RoofKind, base: Base): ConvexOccluder {
  const t = Math.tan(deg2rad(pitchDeg));
  const corners = orientedRect(center, w, d, rotDeg);
  const planes: ConvexOccluder["planes"] = [{ n: [0, 0, -1], d: -eaveZ }];
  const ridgeAlongX = w >= d;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
    const edgeAlongX = i % 2 === 0; // edges 0 and 2 run along local x
    const isEave = kind === "hip" || (kind === "gable" && (ridgeAlongX ? edgeAlongX : !edgeAlongX));
    if (kind === "flat") planes.push({ n: [nx, ny, 0], d: nx * a[0] + ny * a[1] });
    else if (isEave) planes.push({ n: [nx * t, ny * t, 1], d: eaveZ + t * (nx * a[0] + ny * a[1]) });
    else planes.push({ n: [nx, ny, 0], d: nx * a[0] + ny * a[1] }); // vertical gable end
  }
  if (kind === "flat") planes.push({ n: [0, 0, 1], d: eaveZ + 0.2 });
  return { ...base, kind: "convex", planes };
}

/** Height of the ridge above the eave for a roof over w x d at the given pitch (the shorter side sets the rise). */
export function ridgeRise(w: number, d: number, pitchDeg: number, kind: RoofKind): number {
  return kind === "flat" ? 0.2 : (Math.min(w, d) / 2) * Math.tan(deg2rad(pitchDeg));
}
