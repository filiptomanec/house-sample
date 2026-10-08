// Direct-sun hours by ray casting against the house (owned by the Sun page agent from the second phase on; the API below is
// the contract the Model and Sun pages share). Windows and outdoor areas come from `derived`, never from ids:
//
//  * Rooms: every exterior opening that has glazing (`glazingArea > 0`) and a room (`room`) is sampled on a grid of 3 x 6 points
//    (centres of equal cells) in the glass plane, `GLASS_DEPTH` behind the outer face where the model puts the glass (so the
//    reveals shade oblique sun, and the roof overhang shades the upper glass). The value of a window at an instant is the share
//    of its glass in sun; the room's value is its best window. A high summer sun under a deep overhang lights only a low strip of
//    the glass: that strip is counted in proportion, not rounded away (coarse probes read 0 h for such a room).
//    An opening counts only while the sun is in front of its wall (`dot(sun, outward normal) > 0`, the same test as the analytic
//    oracle `sunHoursOnSurface`; at grazing angles the reveal and the wall shade the sample anyway).
//  * "Sun on the window" (`windowSun`): the hours when at least one sample of a glazed window of the room is in sun (transmittance
//    at least `WINDOW_SUN.minTransmittance`) while the sun is at least `WINDOW_SUN.minAltitude` high: the reading of the Czech
//    insolation standard (ČSN 73 4301 counts the time the sun reaches the window), next to the glass-weighted hours above.
//  * Outdoor areas: every `derived.outdoor[]` whose type is in `SUN_SAMPLED_OUTDOOR` (terraces and the pool) and every `covered`
//    area is sampled on a 5 x 3 grid: 0.45 m above the slab top of a terrace (from its grade plane), just above the water of a
//    pool (its `pool.water` rectangle at `pool.waterZ`). Reported twice: with the movable shading as it is (`shades`, slat
//    screens, blinds) and "open" (without it).
//  * Occluders: `house.occluders` (building, roof, posts), the `shades` passed in, and the surroundings as analytic solids
//    with leaf-dependent transmittance (`ctx.layout.occluders()` and `rayTransmittance`, kernel): the neighbours' houses,
//    trees, hedges and fences count, with the leaf state of the day. The terrain beyond the plateau is a horizon: the analytic
//    ground is marched once per direction (`terrainHorizon`) and the sun below it lights nothing. Each sample's value is its
//    transmittance (0 to 1).
//  * Sun position: `calc/sun` for `house.location` (months are 0-based there); the analyser takes a function so tests can inject their own.
//
// Cost and scheduling. A day is about 70 sunlit instants (10 minute steps) times 100 rays. The static house is cast with the
// BVH of three-mesh-bvh; movable slats (hundreds of instances) are tested through a small AABB index built once per call, so a
// lowered blind costs about as much as the house. `day()` is synchronous (some tens of milliseconds on a desktop); on phones
// use `dayAsync()`, which cuts the same work into slices of a few milliseconds and yields to the event loop between them, so
// sliders and scrolling stay smooth. No Web Worker: the scene (geometries with their BVH, the instance matrices of the
// blinds) lives on the main thread, and copying it would cost more memory and start-up time than the slicing costs in latency.
// The open (unshaded) outdoor result does not depend on the shades and is memoised per day, so moving a blind slider only
// recomputes the rooms and the shaded areas.
import * as THREE from "three";
import { dayOfYear } from "@/lib/calendar";
import { SUN_UP_ALTITUDE, localToUtc, placeOf, sunDirection, sunPosition, type CalendarDate, type SunPosition, type Vec3 } from "@/lib/calc/sun";
import { SUN_SAMPLED_OUTDOOR, type DerivedOutdoor } from "@/lib/model";
import type { Occluder } from "@/lib/model/site";
import { rayTransmittance } from "@/lib/model/site/occluders";
import type { HouseContext } from "./context";
import { outwardNormalHouse, toScene } from "./frame";
import type { HouseScene } from "./house";
import type { Viewer } from "./viewer";

/**
 * Position of the sun at a local clock time of `date` (minutes after local midnight, DST-aware). The default is built from
 * `calc/sun`: `sunPosition(localToUtc(place.tz, date, minute / 60), place)` with `place = placeOf(house)`. Tests inject their own.
 */
export type SunPositionFn = (date: CalendarDate, minuteOfDay: number) => Pick<SunPosition, "azimuth" | "altitude">;

export interface SunSeries {
  /** Hours of direct sun over the day (sum of fraction x step). */
  hours: number;
  /** Lit fraction 0..1 at every sampled instant of `SunDayResult.times`. */
  fraction: number[];
}

export interface SunDayResult {
  /** `month` is 0-based, as everywhere in calc/sun. */
  date: CalendarDate;
  /** Step between instants, minutes. */
  step: number;
  /** Local clock hours (decimal) of the sampled instants (middle of each step) at which the sun is above the horizon, ascending. */
  times: number[];
  altitude: number[];
  /** True azimuth (clockwise from true north), as `SunPosition.azimuth` of calc/sun. */
  azimuthTrue: number[];
  /** Per `derived.rooms[].id` of the rooms that have a glazed exterior opening (the hours may be 0); rooms without one are absent. */
  rooms: Record<string, SunSeries>;
  /**
   * "Sun on the window", per room (the same keys as `rooms`): fraction 1 at an instant when any sample of any glazed window of
   * the room is in sun (transmittance at least `WINDOW_SUN.minTransmittance`) and the sun is at least `WINDOW_SUN.minAltitude`
   * high, else 0. Where the glass-weighted fraction is 1 at such an altitude, this one is 1 too.
   */
  windowSun: Record<string, SunSeries>;
  /** Per `derived.outdoor[].id` for the sampled areas (types in `SUN_SAMPLED_OUTDOOR`: terraces, the pool; and covered areas), with the movable shading as set. */
  outdoors: Record<string, SunSeries>;
  /** The same without the movable shading. */
  outdoorsOpen: Record<string, SunSeries>;
}

export interface SunAnalyzerOptions {
  sunPosition?: SunPositionFn;
  /** Count the neighbours, trees, hedges and fences (default true). */
  surroundings?: boolean;
  /** Count the terrain as a horizon (default true). */
  terrain?: boolean;
  /** Test only the surrounding solids that can touch the bundle of rays of one instant (default true; the result is the same, just faster). */
  cull?: boolean;
}

export interface SunAsyncOptions {
  /** Abort the work: the promise resolves with `null` at the next slice. */
  signal?: AbortSignal;
  /** Work per slice, ms (default 8). */
  sliceMs?: number;
}

export interface SampledWindow {
  opening: string;
  room: string;
  /** Outward normal in the scene frame. */
  normal: readonly [number, number, number];
  /** Sample points in the scene frame. */
  points: readonly (readonly [number, number, number])[];
}

export interface SampledArea {
  /** `derived.outdoor[].id`. */
  area: string;
  /** Sample points in the scene frame. */
  points: readonly (readonly [number, number, number])[];
}

export interface SunAnalyzer {
  /**
   * One calendar day (`month` 0-based). `step` in minutes (default 10); `shades` are the movable occluders in their current
   * state (e.g. the outputs of `SlatScreens.occluders()` and `ExtBlinds.occluders()`). Updates world matrices before casting.
   * Synchronous and takes a few tens of milliseconds for a day; call it debounced from UI events, or use `dayAsync`.
   */
  day(date: CalendarDate, step?: number, shades?: readonly THREE.Object3D[]): SunDayResult;
  /** The same result in slices that yield to the event loop; resolves with `null` when aborted. The shades must not change meanwhile (abort first). */
  dayAsync(date: CalendarDate, step?: number, shades?: readonly THREE.Object3D[], opts?: SunAsyncOptions): Promise<SunDayResult | null>;
  /** The sampled windows (for debugging and tests): opening id, room id, outward normal in the scene frame, sample points. */
  readonly windows: readonly SampledWindow[];
  /** The sampled outdoor areas. */
  readonly areas: readonly SampledArea[];
  /** Elevation of the terrain horizon seen from the house in a true azimuth, degrees (negative: the ground falls away). */
  terrainHorizon(azimuthTrue: number): number;
  /** For debugging: every static house mesh a ray from `origin` (scene frame) towards `direction` meets (its nearest hit), nearest first, with its role and id. */
  blockers(origin: readonly [number, number, number], direction: readonly [number, number, number]): { distance: number; role?: string; id?: string; name: string }[];
}

// ------------------------------------------------------------------------------------------------ sampling parameters
// Properties of the method, not of any house.

/**
 * Sample grid of a window: positions across its width (fractions of the width from its centre) and the number of equal rows
 * from sill to head (a sample sits in the middle of each row, so the lit share of the samples estimates the lit share of the glass).
 */
export const WINDOW_GRID = { across: [-1 / 3, 0, 1 / 3], rows: 6 } as const;
/**
 * The samples lie in the glass plane: the model puts the frame 0.10 m behind the outer face of the wall and the glass in the middle
 * of a 0.07 m deep frame (pipeline/blender/hb/params.py: `setback`, `frame_depth`). At most 60 % of a thin wall.
 */
export const GLASS_DEPTH = 0.135;
/** Outdoor areas: grid of samples and their height above the slab top (a person sitting) or above the water of a pool. */
const AREA_GRID = { nx: 5, ny: 3 } as const;
const AREA_SAMPLE_HEIGHT = 0.45;
const WATER_SAMPLE_HEIGHT = 0.03;
/** "Sun on the window": a sample counts as sunlit from this transmittance on, and only while the sun is at least this high (degrees). */
export const WINDOW_SUN = { minTransmittance: 0.5, minAltitude: 5 } as const;
/** Rays start this far from the sample towards the open side, so they do not hit the surface they start on. */
const RAY_START_OFFSET = 0.03;
/** Terrain horizon: directions per circle, eye height above the floor, distances marched (geometric steps), m. */
const HORIZON_BINS = 120;
const HORIZON_EYE = 1;
const HORIZON_FROM = 6;
const HORIZON_GROWTH = 1.12;

type Pt3 = [number, number, number];

interface Sample {
  house: Pt3;
  scene: THREE.Vector3;
}

interface WindowSamples {
  opening: string;
  room: string;
  /** Outward normal in the house frame (horizontal) and in the scene frame. */
  normalHouse: Vec3;
  normalScene: THREE.Vector3;
  points: Sample[];
}

interface AreaSamples {
  area: string;
  points: Sample[];
}

const sample = (h: Pt3): Sample => {
  const s = toScene(h);
  return { house: h, scene: new THREE.Vector3(s[0], s[1], s[2]) };
};

/** The glazed exterior openings of the model with their sample points. */
export function sampleWindows(ctx: HouseContext): WindowSamples[] {
  const out: WindowSamples[] = [];
  for (const o of ctx.derived.openings) {
    if (o.exterior !== true || !(o.glazingArea > 0) || o.room === null || o.azimuth === null) continue;
    const wall = ctx.derived.walls.find((w) => w.id === o.wallId);
    const thickness = wall?.t ?? ctx.derived.wall.ext;
    const [nx, ny] = outwardNormalHouse(o.azimuth);
    const along: [number, number] = o.orient === "h" ? [1, 0] : [0, 1];
    const out_ = thickness / 2 - Math.min(GLASS_DEPTH, 0.6 * thickness);
    const points: Sample[] = [];
    for (const u of WINDOW_GRID.across) {
      for (let row = 0; row < WINDOW_GRID.rows; row++) {
        const v = (row + 0.5) / WINDOW_GRID.rows;
        points.push(sample([
          o.cx + along[0] * u * o.w + nx * out_,
          o.cy + along[1] * u * o.w + ny * out_,
          o.sill + (o.head - o.sill) * v,
        ]));
      }
    }
    const ns = toScene([nx, ny, 0]);
    out.push({ opening: o.id, room: o.room, normalHouse: [nx, ny, 0], normalScene: new THREE.Vector3(ns[0], ns[1], ns[2]), points });
  }
  return out;
}

/** Is an outdoor area sampled by the analysis? Its type is in `SUN_SAMPLED_OUTDOOR` (terraces, the pool), or it is covered. */
export const isSampledArea = (a: Pick<DerivedOutdoor, "type" | "covered">): boolean => (SUN_SAMPLED_OUTDOOR as readonly string[]).includes(a.type) || a.covered;

/** The sampled outdoor areas with their sample grid: over the slab top of a terrace, just above the water of a pool. */
export function sampleAreas(ctx: HouseContext): AreaSamples[] {
  const out: AreaSamples[] = [];
  for (const a of ctx.derived.outdoor) {
    if (!isSampledArea(a)) continue;
    const [x0, y0, x1, y1] = a.pool ? a.pool.water : a.rect;
    const pl = a.grade.plane;
    const at = (x: number, y: number) => (a.pool ? a.pool.waterZ + WATER_SAMPLE_HEIGHT : pl.z0 + pl.gx * (x - pl.ox) + pl.gy * (y - pl.oy) + AREA_SAMPLE_HEIGHT);
    const points: Sample[] = [];
    for (let i = 0; i < AREA_GRID.nx; i++) {
      for (let j = 0; j < AREA_GRID.ny; j++) {
        const x = x0 + ((i + 0.5) / AREA_GRID.nx) * (x1 - x0), y = y0 + ((j + 0.5) / AREA_GRID.ny) * (y1 - y0);
        points.push(sample([x, y, at(x, y)]));
      }
    }
    out.push({ area: a.id, points });
  }
  return out;
}

/** Elevation angle (degrees) of the terrain seen from the house centre in each direction of a circle of `HORIZON_BINS`. */
function makeHorizon(ctx: HouseContext): (azimuthTrue: number) => number {
  const b = ctx.derived.bbox;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const { groundAt } = ctx.site.terrain;
  const eye = groundAt(cx, cy) + HORIZON_EYE;
  const bounds = ctx.site.bounds;
  const table = new Float64Array(HORIZON_BINS).fill(Number.NaN);
  return (azimuthTrue) => {
    const bin = Math.round((((azimuthTrue % 360) + 360) % 360) / (360 / HORIZON_BINS)) % HORIZON_BINS;
    if (Number.isNaN(table[bin])) {
      const a = ((bin * (360 / HORIZON_BINS) - ctx.bearingDeg) * Math.PI) / 180;
      const dx = Math.sin(a), dy = Math.cos(a);
      let best = -90;
      for (let d = HORIZON_FROM; ; d *= HORIZON_GROWTH) {
        const x = cx + dx * d, y = cy + dy * d;
        if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) break; // the model knows no ground beyond its domain
        best = Math.max(best, (Math.atan2(groundAt(x, y) - eye, d) * 180) / Math.PI);
      }
      table[bin] = best;
    }
    return table[bin];
  };
}

// ------------------------------------------------------------------------------------------------ culling the surroundings

export interface Bound {
  c: Vec3;
  r: number;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Corners of a convex solid given as half-spaces `n . p <= d` (all triples of planes, kept when inside the others). */
function convexCorners(planes: readonly { n: Vec3; d: number }[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const a = planes[i], b = planes[j], c = planes[k];
        const bc = cross3(b.n, c.n), ca = cross3(c.n, a.n), ab = cross3(a.n, b.n);
        const det = dot3(a.n, bc);
        if (Math.abs(det) < 1e-9) continue;
        const p: Vec3 = [0, 1, 2].map((m) => (a.d * bc[m] + b.d * ca[m] + c.d * ab[m]) / det) as Vec3;
        if (planes.every((q) => dot3(q.n, p) <= q.d + 1e-6 * Math.hypot(...q.n))) out.push(p);
      }
    }
  }
  return out;
}

/** A sphere that contains the solid. An unbounded or degenerate solid gets an infinite radius (it is never culled). */
export function occluderBound(o: Occluder): Bound {
  switch (o.kind) {
    case "sphere": return { c: o.center, r: o.radius };
    case "ellipsoid": return { c: o.center, r: Math.max(...o.radii) };
    case "box": {
      const c: Vec3 = [(o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2];
      return { c, r: Math.hypot(...sub3(o.max, c)) };
    }
    case "convex": {
      const v = convexCorners(o.planes);
      if (v.length < 4) return { c: [0, 0, 0], r: Infinity };
      const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const p of v) for (let m = 0; m < 3; m++) { lo[m] = Math.min(lo[m], p[m]); hi[m] = Math.max(hi[m], p[m]); }
      const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      return { c, r: Math.max(...v.map((p) => Math.hypot(...sub3(p, c)))) };
    }
  }
}

/**
 * The solids that can touch a ray travelling in `dir` from anywhere within `reach` of `origin`: a solid is kept when its bounding
 * sphere, grown by `reach`, meets the half-line from `origin` along `dir` (and the sphere behind the origin by `reach`).
 */
export function cullOccluders<T extends { bound: Bound }>(items: readonly T[], origin: Vec3, reach: number, dir: Vec3): T[] {
  return items.filter(({ bound }) => {
    const rel = sub3(bound.c, origin);
    const along = dot3(rel, dir);
    const radius = bound.r + reach;
    if (along < -radius) return false;
    return dot3(rel, rel) - along * along <= radius * radius;
  });
}

// ------------------------------------------------------------------------------------------------ casting

/**
 * Ray casts against meshes (the static house: BVH per mesh, from three-mesh-bvh). A cheap slab test against the world box of
 * every mesh comes first; only the meshes the ray can reach are asked for an exact answer, and the first hit ends the search.
 * `refresh()` recomputes the boxes from the current world matrices (call it after `updateMatrixWorld`).
 */
export class Caster {
  private readonly ray = new THREE.Raycaster();
  private readonly meshes: THREE.Mesh[];
  private boxes: Float64Array;
  private readonly hits: THREE.Intersection[] = [];
  private readonly box = new THREE.Box3();
  constructor(objects: readonly THREE.Object3D[], far: number) {
    this.meshes = objects.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true);
    this.boxes = new Float64Array(this.meshes.length * 6);
    this.ray.far = far;
    (this.ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    this.refresh();
  }
  get count() { return this.meshes.length; }
  refresh() {
    this.meshes.forEach((m, i) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      this.box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      const k = i * 6, { min, max } = this.box;
      this.boxes[k] = min.x; this.boxes[k + 1] = min.y; this.boxes[k + 2] = min.z;
      this.boxes[k + 3] = max.x; this.boxes[k + 4] = max.y; this.boxes[k + 5] = max.z;
    });
  }
  blocked(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    const b = this.boxes, far = this.ray.far;
    const ix = 1 / dir.x, iy = 1 / dir.y, iz = 1 / dir.z;
    let prepared = false;
    for (let i = 0, n = this.meshes.length; i < n; i++) {
      const k = i * 6;
      let t0 = 0, t1 = far;
      let a = (b[k] - origin.x) * ix, c = (b[k + 3] - origin.x) * ix;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a; if (c < t1) t1 = c;
      a = (b[k + 1] - origin.y) * iy; c = (b[k + 4] - origin.y) * iy;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a; if (c < t1) t1 = c;
      a = (b[k + 2] - origin.z) * iz; c = (b[k + 5] - origin.z) * iz;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a; if (c < t1) t1 = c;
      if (t0 > t1) continue; // (a NaN from 0 * Infinity compares false and falls through to the exact test)
      if (!prepared) { this.ray.set(origin, dir); prepared = true; }
      this.hits.length = 0;
      this.meshes[i].raycast(this.ray, this.hits);
      if (this.hits.length) return true;
    }
    return false;
  }
}

/**
 * The movable shading as the sun sees it. Instanced meshes (slats) are reduced to world-space boxes once and tested with a slab
 * test before the exact test in the local frame of the instance (a slat is its bounding box); other meshes use the normal raycast.
 */
class ShadeIndex {
  private readonly boxes: Float64Array;
  private readonly inverses: THREE.Matrix4[] = [];
  private readonly locals: THREE.Box3[] = [];
  private readonly plain: THREE.Mesh[] = [];
  private readonly plainCaster: Caster;
  readonly count: number;
  private readonly local = new THREE.Ray();
  private readonly world = new THREE.Ray();

  constructor(shades: readonly THREE.Object3D[], far: number) {
    const boxes: number[] = [];
    const m = new THREE.Matrix4(), world = new THREE.Box3();
    const visit = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if ((o as THREE.InstancedMesh).isInstancedMesh) {
        const im = o as THREE.InstancedMesh;
        im.geometry.computeBoundingBox();
        const lb = im.geometry.boundingBox!;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m);
          m.premultiply(im.matrixWorld);
          world.copy(lb).applyMatrix4(m);
          boxes.push(world.min.x, world.min.y, world.min.z, world.max.x, world.max.y, world.max.z);
          this.inverses.push(m.clone().invert());
          this.locals.push(lb);
        }
      } else if (mesh.isMesh) {
        this.plain.push(mesh);
      }
    };
    for (const s of shades) s.traverse(visit);
    this.boxes = Float64Array.from(boxes);
    this.plainCaster = new Caster(this.plain, far);
    this.count = this.inverses.length + this.plain.length;
  }

  blocked(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    const b = this.boxes;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const ix = 1 / dir.x, iy = 1 / dir.y, iz = 1 / dir.z;
    for (let i = 0, n = this.inverses.length; i < n; i++) {
      const k = i * 6;
      let t0 = 0, t1 = Infinity;
      let a = (b[k] - ox) * ix, c = (b[k + 3] - ox) * ix;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      a = (b[k + 1] - oy) * iy; c = (b[k + 4] - oy) * iy;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      a = (b[k + 2] - oz) * iz; c = (b[k + 5] - oz) * iz;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) continue;
      this.world.set(origin, dir);
      this.local.copy(this.world).applyMatrix4(this.inverses[i]);
      if (this.local.intersectsBox(this.locals[i])) return true;
    }
    return this.plain.length > 0 && this.plainCaster.blocked(origin, dir);
  }
}

const yieldToMain = (): Promise<void> => {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return sched?.yield ? sched.yield() : new Promise((resolve) => setTimeout(resolve, 0));
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Maximum entries of the memo of open-area results (days). */
const OPEN_CACHE_SIZE = 64;

const emptySeries = (): SunSeries => ({ hours: 0, fraction: [] });

/**
 * Creates the analyser for a built house. `viewer` is only needed to bring the world matrices up to date before casting;
 * `scene` supplies the context and the static occluders. Both parameters are structural so tests can pass plain objects.
 */
export function makeSunAnalyzer(viewer: Pick<Viewer, "scene">, scene: Pick<HouseScene, "ctx" | "occluders">, opts: SunAnalyzerOptions = {}): SunAnalyzer {
  const { ctx } = scene;
  const place = placeOf(ctx.house);
  const bearing = ctx.bearingDeg;
  const sunAt: SunPositionFn = opts.sunPosition ?? ((date, minute) => sunPosition(localToUtc(place.tz, date, minute / 60), place));
  const windows = sampleWindows(ctx);
  const areas = sampleAreas(ctx);
  const surroundings = (opts.surroundings === false ? [] : ctx.layout.occluders()).map((solid) => ({ solid, bound: occluderBound(solid) }));
  // the bundle of rays of one instant starts anywhere within `reach` of the centre of the sample points
  const allPoints = [...windows, ...areas].flatMap((w) => w.points.map((p) => p.house));
  const centre: Vec3 = allPoints.length ? [0, 1, 2].map((m) => allPoints.reduce((a, p) => a + p[m], 0) / allPoints.length) as Vec3 : [0, 0, 0];
  const reach = Math.max(0, ...allPoints.map((p) => Math.hypot(...sub3(p, centre)))) + 2 * RAY_START_OFFSET;
  const cull = opts.cull !== false;
  const horizon = opts.terrain === false ? () => -90 : makeHorizon(ctx);
  const b = ctx.derived.bbox;
  const far = Math.hypot(b.w, b.d, b.z1) + 20;
  const house = new Caster(scene.occluders, far);
  const rooms = [...new Set(windows.map((w) => w.room))];
  const openCache = new Map<string, Record<string, SunSeries>>();

  function* job(date: CalendarDate, step: number, shades: readonly THREE.Object3D[]): Generator<void, SunDayResult, void> {
    if (!Number.isFinite(step) || step <= 0) throw new RangeError(`sunAnalysis: step must be positive: ${step}`);
    viewer.scene.updateMatrixWorld(true); // matrices must be current before casting (slat angle, blind drop)
    house.refresh();
    const doy = dayOfYear(date.month, date.day);
    const shadeIndex = new ShadeIndex(shades, far);
    const key = `${date.year}-${date.month}-${date.day}-${step}`;
    const cachedOpen = openCache.get(key);
    const computeOpen = !cachedOpen;
    const computeShaded = shadeIndex.count > 0 || computeOpen;

    const result: SunDayResult = { date: { ...date }, step, times: [], altitude: [], azimuthTrue: [], rooms: {}, windowSun: {}, outdoors: {}, outdoorsOpen: {} };
    for (const r of rooms) { result.rooms[r] = emptySeries(); result.windowSun[r] = emptySeries(); }
    for (const a of areas) { result.outdoors[a.area] = emptySeries(); result.outdoorsOpen[a.area] = emptySeries(); }
    const stepHours = step / 60;
    const dirScene = new THREE.Vector3(), origin = new THREE.Vector3();
    const roomNow: Record<string, number> = {};
    const anyNow: Record<string, number> = {};

    /** The surrounding solids that matter for this instant (set per instant). */
    let nearby: Occluder[] = [];
    /** Transmittance of the surroundings along the ray from a sample (0 = fully shaded). */
    const around = (p: Sample, dirH: Vec3, offsetH: Vec3): number => {
      if (!nearby.length) return 1;
      return rayTransmittance(nearby, [p.house[0] + offsetH[0] * RAY_START_OFFSET, p.house[1] + offsetH[1] * RAY_START_OFFSET, p.house[2] + offsetH[2] * RAY_START_OFFSET], dirH, doy);
    };

    for (let k = 0; k * step < 1440; k++) {
      const minute = k * step + step / 2;
      if (minute >= 1440) break;
      const sun = sunAt(date, minute);
      if (!(sun.altitude > SUN_UP_ALTITUDE)) continue;
      const dirH = sunDirection(sun.azimuth, sun.altitude, bearing);
      const s = toScene(dirH);
      dirScene.set(s[0], s[1], s[2]);
      const hidden = sun.altitude < horizon(sun.azimuth);
      nearby = (cull ? cullOccluders(surroundings, centre, reach, dirH) : surroundings).map((x) => x.solid);

      result.times.push(minute / 60);
      result.altitude.push(sun.altitude);
      result.azimuthTrue.push(sun.azimuth);

      // rooms: the best window of each room, and whether the sun reaches any window of it at all
      for (const r of rooms) { roomNow[r] = 0; anyNow[r] = 0; }
      const highEnough = sun.altitude >= WINDOW_SUN.minAltitude;
      if (!hidden) {
        for (const w of windows) {
          if (dirH[0] * w.normalHouse[0] + dirH[1] * w.normalHouse[1] <= 0) continue; // the sun is behind the wall
          // another window of the room is fully lit already: this one cannot add to the best (nor to "any")
          if (roomNow[w.room] >= 1) continue;
          let sum = 0;
          for (const p of w.points) {
            origin.copy(p.scene).addScaledVector(w.normalScene, RAY_START_OFFSET);
            if (house.blocked(origin, dirScene) || shadeIndex.blocked(origin, dirScene)) continue;
            const t = around(p, dirH, w.normalHouse);
            sum += t;
            if (highEnough && t >= WINDOW_SUN.minTransmittance) anyNow[w.room] = 1;
          }
          roomNow[w.room] = Math.max(roomNow[w.room], sum / w.points.length);
          if (highEnough && roomNow[w.room] >= 1) anyNow[w.room] = 1;
        }
      }
      for (const r of rooms) {
        result.rooms[r].fraction.push(roomNow[r]); result.rooms[r].hours += roomNow[r] * stepHours;
        result.windowSun[r].fraction.push(anyNow[r]); result.windowSun[r].hours += anyNow[r] * stepHours;
      }

      // outdoor areas, as set and open
      for (const a of areas) {
        let shaded = 0, open = 0;
        if (!hidden && (computeShaded || computeOpen)) {
          for (const p of a.points) {
            origin.copy(p.scene).addScaledVector(dirScene, RAY_START_OFFSET);
            if (house.blocked(origin, dirScene)) continue;
            const t = around(p, dirH, dirH);
            if (t <= 0) continue;
            open += t;
            if (shadeIndex.count === 0 || !shadeIndex.blocked(origin, dirScene)) shaded += t;
          }
          shaded /= a.points.length; open /= a.points.length;
        }
        const o = cachedOpen ? cachedOpen[a.area].fraction[result.times.length - 1] : open;
        const sh = shadeIndex.count === 0 ? o : shaded;
        result.outdoors[a.area].fraction.push(sh); result.outdoors[a.area].hours += sh * stepHours;
        result.outdoorsOpen[a.area].fraction.push(o); result.outdoorsOpen[a.area].hours += o * stepHours;
      }
      yield;
    }
    if (computeOpen) {
      if (openCache.size >= OPEN_CACHE_SIZE) openCache.delete(openCache.keys().next().value as string);
      openCache.set(key, Object.fromEntries(Object.entries(result.outdoorsOpen).map(([id, s]) => [id, { hours: s.hours, fraction: s.fraction.slice() }])));
    }
    return result;
  }

  return {
    windows: windows.map((w) => ({
      opening: w.opening, room: w.room,
      normal: [w.normalScene.x, w.normalScene.y, w.normalScene.z] as const,
      points: w.points.map((p) => [p.scene.x, p.scene.y, p.scene.z] as const),
    })),
    areas: areas.map((a) => ({ area: a.area, points: a.points.map((p) => [p.scene.x, p.scene.y, p.scene.z] as const) })),
    terrainHorizon: horizon,
    blockers(o, d) {
      viewer.scene.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize(), 0, far);
      const seen = new Set<THREE.Object3D>();
      return ray.intersectObjects(scene.occluders as unknown as THREE.Object3D[], false).filter((h) => !seen.has(h.object) && seen.add(h.object)).map((h) => {
        const u = h.object.userData as { role?: string; id?: string };
        return { distance: h.distance, role: u.role, id: u.id, name: h.object.name };
      });
    },
    day(date, step = 10, shades = []) {
      const g = job(date, step, shades);
      for (let r = g.next(); ; r = g.next()) if (r.done) return r.value;
    },
    async dayAsync(date, step = 10, shades = [], o = {}) {
      const g = job(date, step, shades);
      const slice = o.sliceMs ?? 8;
      let started = now();
      for (let r = g.next(); ; r = g.next()) {
        if (r.done) return r.value;
        if (o.signal?.aborted) return null;
        if (now() - started >= slice) {
          await yieldToMain();
          if (o.signal?.aborted) return null;
          started = now();
        }
      }
    },
  };
}
