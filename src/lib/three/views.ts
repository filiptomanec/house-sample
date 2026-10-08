// Camera views of the 3D engine, from the model cameras (docs/HOUSE-FORMAT.md section 4.6). Pure, no three.js.
//
// The viewer renders every view with one perspective camera. An orthographic camera of the model (the "top view") is
// approximated by a long lens: same direction and target, the distance chosen so that the visible height at the target
// equals `orthoHeight`; the pages use it refitted to `TOP_VIEW_FOV` (`refitLens`) so it stays inside the orbit limits and the fog.
//
// Both 3D pages share one recipe (`pageViews`, `pageLimits`): the cameras of the page (`use` "web" for the Model page, "sun"
// for the Sun page) from `derived.cameras` (z resolved from `aboveGround`), the top view refitted, the orbit limits widened so
// every preset is reachable. A view was composed for a 16:10 stage (`DESIGN_ASPECT`); on a narrower stage `fitView` keeps its
// horizontal coverage: it widens the field of view first (up to `FOV_MAX`) and moves the camera back only where that is safe:
// an elevated view, or an eye-level view whose way back stays on the same side of the plot boundary and outside the building.
import type { Camera, DerivedCamera, LocalizedText } from "@/lib/model";
import type { Occluder, XY } from "@/lib/model/site";
import type { HouseContext } from "./context";
import { sceneExtent } from "./context";
import { toScene, type Vec3 } from "./frame";

/** Field of view (degrees) that replaces an orthographic projection. */
export const ORTHO_APPROX_FOV = 6;
/** Field of view of the top view on the pages, degrees: long enough to look like a plan, short enough to stay inside the orbit limits and the fog. */
export const TOP_VIEW_FOV = 20;
/** Room beyond the farthest preset, so that the view is not pressed against the limit. */
export const VIEW_REACH_MARGIN = 1.05;
/** The aspect (width / height) the camera presets were composed for. */
export const DESIGN_ASPECT = 16 / 10;
/** The widest vertical field of view `fitView` widens to, degrees. */
export const FOV_MAX = 78;
/** A camera this high above the ground (m) is an elevated view: it may move back freely. */
export const ELEVATED_MIN = 4;

/** A view ready for the viewer: scene-frame position and target (Y-up) and a vertical field of view. */
export interface ResolvedView {
  /** Id of the camera in the model (a label for the UI and for URLs; never branch on it). */
  id: string;
  /** Bilingual name from the model. */
  name: LocalizedText;
  /** Short chip label (`cameras[].short`), null when the model has none (use `name`). */
  short?: LocalizedText | null;
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** True when this view stands in for an orthographic camera (also after `refitLens`). */
  ortho: boolean;
  /** The opening view of the pages (`cameras[].default`) and the stage classes it opens on (`defaultFor`, "narrow" = phones). */
  default?: boolean;
  defaultFor?: readonly string[];
}

/** What a camera of the model looks like to this module: `house.cameras[]` or `derived.cameras[]` (z resolved). */
export type CameraLike = Pick<Camera, "id" | "name" | "kind" | "position" | "target" | "use"> & {
  fov?: number | null;
  orthoHeight?: number | null;
  short?: LocalizedText | null;
  default?: boolean;
  defaultFor?: readonly string[];
};

/** Distance from the target at which a perspective camera with `fov` sees `height` metres at the target. */
export function distanceForVisibleHeight(height: number, fovDeg: number): number {
  return height / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

const distanceOf = (v: Pick<ResolvedView, "position" | "target">): number =>
  Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);

/** Converts a model camera (house frame) into a view (scene frame, perspective only). */
export function resolveView(cam: CameraLike): ResolvedView {
  const position = toScene(cam.position), target = toScene(cam.target);
  const extra = { short: cam.short ?? null, default: cam.default ?? false, defaultFor: cam.defaultFor ?? [] };
  if (cam.kind === "perspective") return { id: cam.id, name: cam.name, position, target, fov: cam.fov ?? 40, ortho: false, ...extra };
  const dir: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const len = Math.hypot(...dir) || 1;
  const d = distanceForVisibleHeight(cam.orthoHeight ?? 10, ORTHO_APPROX_FOV);
  return {
    id: cam.id, name: cam.name, target, fov: ORTHO_APPROX_FOV, ortho: true, ...extra,
    position: [target[0] + (dir[0] / len) * d, target[1] + (dir[1] / len) * d, target[2] + (dir[2] / len) * d],
  };
}

/** The cameras meant for a use ("web" for the Model page, "sun" for the Sun page, "render" for stills, "og"), in model order. */
export function camerasFor<C extends Pick<CameraLike, "use">>(cameras: readonly C[], use: Camera["use"][number] = "web"): C[] {
  return cameras.filter((c) => (c.use as readonly string[]).includes(use));
}

/** Resolved web views in model order (house.json cameras; prefer `pageViews`, which uses the resolved z and refits the top view). */
export function webViews(cameras: readonly CameraLike[]): ResolvedView[] {
  return camerasFor(cameras, "web").map(resolveView);
}

/**
 * The same view with another field of view and the distance that shows the same height at the target, so the framing is
 * kept. The engine renders an orthographic camera as a 6 degree lens, which for a plot-sized frame stands further away than the
 * camera may go (and than the fog lets through).
 */
export function refitLens<V extends Pick<ResolvedView, "position" | "target" | "fov">>(view: V, fov: number): V {
  const d = distanceOf(view);
  if (d === 0 || fov <= 0) return view;
  const visible = 2 * d * Math.tan((view.fov * Math.PI) / 360);
  const next = visible / (2 * Math.tan((fov * Math.PI) / 360));
  const k = next / d;
  const position: Vec3 = [
    view.target[0] + (view.position[0] - view.target[0]) * k,
    view.target[1] + (view.position[1] - view.target[1]) * k,
    view.target[2] + (view.position[2] - view.target[2]) * k,
  ];
  return { ...view, position, fov };
}

export type ViewPage = "model" | "sun";

/** The presets of a 3D page in model order: `derived.cameras` with use "web" (Model) or "sun" (Sun), the top view refitted. */
export function pageViews(ctx: Pick<HouseContext, "derived">, page: ViewPage): ResolvedView[] {
  return camerasFor(ctx.derived.cameras as readonly DerivedCamera[], page === "sun" ? "sun" : "web")
    .map(resolveView)
    .map((v) => (v.ortho ? refitLens(v, TOP_VIEW_FOV) : v));
}

/** The view to open with: the one marked for the stage class (`defaultFor`, "narrow" on phones), else the default, else the first. */
export function defaultView(views: readonly ResolvedView[], narrow = false): ResolvedView | undefined {
  return (narrow ? views.find((v) => v.defaultFor?.includes("narrow")) : undefined) ?? views.find((v) => v.default) ?? views[0];
}

/** Limits of the orbit camera, derived from the extent of the scene (never typed in per house). */
export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  /** The orbit target stays inside this box (scene frame). */
  targetMin: Vec3;
  targetMax: Vec3;
  /** The camera never goes below the ground: maximum polar angle, radians. */
  maxPolarAngle: number;
}

/** A sphere around the part of the world the user may look at (scene frame). */
export interface SceneExtent {
  /** Centre in the house frame (x, y, z up). */
  center: [number, number, number];
  /** Radius in metres. */
  radius: number;
  /** Highest point of the building (ridge), metres above the floor: the target never goes above it. */
  top: number;
}

/** Tuning of the orbit limits (about usability, not about the house). */
export const ORBIT = { minDistance: 1.5, maxDistanceFactor: 4, polarMargin: 0.005 } as const;

export function orbitLimitsFor(extent: SceneExtent): OrbitLimits {
  const [cx, cy] = extent.center, r = extent.radius;
  return {
    minDistance: ORBIT.minDistance,
    maxDistance: r * ORBIT.maxDistanceFactor,
    targetMin: [cx - r, 0, -(cy + r)],
    targetMax: [cx + r, extent.top, -(cy - r)],
    maxPolarAngle: Math.PI * (0.5 - ORBIT.polarMargin),
  };
}

/** The limits, with the maximum distance widened (never narrowed) so that every view is within it. */
export function limitsForViews(base: OrbitLimits, views: readonly Pick<ResolvedView, "position" | "target">[]): OrbitLimits {
  const farthest = views.reduce((m, v) => Math.max(m, distanceOf(v)), 0);
  return { ...base, maxDistance: Math.max(base.maxDistance, farthest * VIEW_REACH_MARGIN) };
}

/** The extent of a page: the whole plot (Model) or the building with a margin (Sun close-ups). */
export const pageExtent = (ctx: HouseContext, page: ViewPage): SceneExtent => sceneExtent(ctx, page === "sun" ? "house" : "plot");

/** The orbit limits of a page: from its extent, widened to reach every preset (fitted at the narrowest supported stage). */
export function pageLimits(ctx: HouseContext, page: ViewPage, views: readonly ResolvedView[] = pageViews(ctx, page)): OrbitLimits {
  const fc = fitContextOf(ctx);
  const fitted = views.flatMap((v) => FIT_ASPECTS.map((a) => fitView(v, a, fc)));
  return limitsForViews(orbitLimitsFor(pageExtent(ctx, page)), [...views, ...fitted]);
}

/** The stage aspects the fitting is checked for (portrait phone, square, landscape phone). */
export const FIT_ASPECTS = [0.75, 1, 1.45] as const;

// ------------------------------------------------------------------------------------------------ aspect-aware fitting

/** What `fitView` needs to know about the world (house frame). Built by `fitContextOf(ctx)`. */
export interface FitContext {
  /** The plot ring and the outline of the building. */
  plot: readonly XY[];
  footprint: readonly XY[];
  /** Graded ground height. */
  groundAt(x: number, y: number): number;
  /** The domain of the scene (the ground ends there). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export function fitContextOf(ctx: HouseContext): FitContext {
  return {
    plot: ctx.site.plot,
    footprint: ctx.derived.outline.polygons[0]?.pts ?? [],
    groundAt: (x, y) => ctx.site.terrain.groundAt(x, y),
    bounds: ctx.site.bounds,
  };
}

const inRing = (p: XY, ring: readonly XY[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Height of a scene-frame point above the ground. */
export const heightAboveGround = (p: Readonly<Vec3>, fc: Pick<FitContext, "groundAt">): number => p[1] - fc.groundAt(p[0], -p[2]);

/** Is a view elevated (an aerial or the top view)? Eye-level views stand within `ELEVATED_MIN` of the ground. */
export const isElevated = (v: Pick<ResolvedView, "position" | "ortho">, fc: Pick<FitContext, "groundAt">): boolean =>
  v.ortho || heightAboveGround(v.position, fc) >= ELEVATED_MIN;

/** May the camera move back from `from` to `to` (scene frame)? Elevated: anywhere; eye level: same side of the plot boundary, never into the building, inside the domain. */
function wayBackIsFree(from: Readonly<Vec3>, to: Readonly<Vec3>, elevated: boolean, fc: FitContext): boolean {
  if (elevated) return true;
  const start: XY = [from[0], -from[2]];
  const side = inRing(start, fc.plot);
  if (fc.footprint.length >= 3 && inRing(start, fc.footprint)) return false; // indoors: never through the walls
  const b = fc.bounds;
  const N = 24;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const p: XY = [from[0] + (to[0] - from[0]) * t, -(from[2] + (to[2] - from[2]) * t)];
    if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) return false;
    if (inRing(p, fc.plot) !== side) return false;
    if (fc.footprint.length >= 3 && inRing(p, fc.footprint)) return false;
  }
  return true;
}

/** The result of `fitView`: the fitted view plus how it was changed. */
export interface FittedView extends ResolvedView {
  /** Factor the distance to the target was multiplied by (1 = not moved) and whether the field of view was widened. */
  dolly: number;
  widened: boolean;
}

const tanHalf = (fovDeg: number) => Math.tan((fovDeg * Math.PI) / 360);
const fovOfTanHalf = (t: number) => (Math.atan(t) * 360) / Math.PI;

/**
 * The view at a stage aspect (width / height). On a stage at least as wide as `DESIGN_ASPECT` the view is unchanged. On a
 * narrower one the horizontal coverage of the design is kept: the vertical field of view widens up to `FOV_MAX` (an
 * orthographic stand-in never widens, it stays a long lens), and whatever is still missing is made up by moving the camera
 * back along its line of sight, as far as `wayBackIsFree` allows (elevated views always; eye-level views only while they stay on
 * their side of the plot boundary and out of the building). Without a fit context the camera never moves. Pure.
 */
export function fitView(view: ResolvedView, aspect: number, fc?: FitContext): FittedView {
  if (!(aspect > 0) || aspect >= DESIGN_ASPECT - 1e-9) return { ...view, dolly: 1, widened: false };
  const needV = (tanHalf(view.fov) * DESIGN_ASPECT) / aspect; // vertical half-tangent that keeps the design's horizontal coverage
  const fov = view.ortho ? view.fov : Math.min(FOV_MAX, fovOfTanHalf(needV));
  const want = needV / tanHalf(fov);
  let dolly = 1;
  if (want > 1 + 1e-9 && fc) {
    const elevated = isElevated(view, fc);
    const at = (k: number): Vec3 => [
      view.target[0] + (view.position[0] - view.target[0]) * k,
      view.target[1] + (view.position[1] - view.target[1]) * k,
      view.target[2] + (view.position[2] - view.target[2]) * k,
    ];
    if (wayBackIsFree(view.position, at(want), elevated, fc)) dolly = want;
    else {
      // the largest free part of the way (the predicate is monotone along the line of sight)
      let lo = 1, hi = want;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (wayBackIsFree(view.position, at(mid), elevated, fc)) lo = mid; else hi = mid;
      }
      dolly = lo;
    }
    return { ...view, fov, position: at(dolly), dolly, widened: fov > view.fov + 1e-9 };
  }
  return { ...view, fov, dolly, widened: fov > view.fov + 1e-9 };
}

// ------------------------------------------------------------------------------------------------ shadows

/** The shadow frustum covers the extent with a small margin (the sun shadow camera is orthographic). */
export const SHADOW_MARGIN = 1.1;
/** Room beyond the farthest site occluder, metres. */
export const SHADOW_OCCLUDER_MARGIN = 2;

/** Farthest horizontal reach of an analytic occluder from a point (house frame), metres. */
function occluderReach(o: Occluder, c: XY): number {
  switch (o.kind) {
    case "sphere": return Math.hypot(o.center[0] - c[0], o.center[1] - c[1]) + o.radius;
    case "ellipsoid": return Math.hypot(o.center[0] - c[0], o.center[1] - c[1]) + Math.max(o.radii[0], o.radii[1]);
    case "box": return Math.max(...[[o.min[0], o.min[1]], [o.max[0], o.min[1]], [o.max[0], o.max[1]], [o.min[0], o.max[1]]].map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    case "convex": {
      // a prism: its side planes bound it; the corners in plan are where two vertical planes meet (z components 0)
      const side = o.planes.filter((p) => Math.abs(p.n[2]) < 1e-9 && Math.hypot(p.n[0], p.n[1]) > 1e-9);
      let best = 0;
      for (let i = 0; i < side.length; i++) {
        for (let j = i + 1; j < side.length; j++) {
          const a = side[i], b = side[j];
          const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
          if (Math.abs(det) < 1e-9) continue;
          const x = (a.d * b.n[1] - b.d * a.n[1]) / det, y = (a.n[0] * b.d - b.n[0] * a.d) / det;
          if (side.every((p) => p.n[0] * x + p.n[1] * y <= p.d + 1e-6)) best = Math.max(best, Math.hypot(x - c[0], y - c[1]));
        }
      }
      return best;
    }
  }
}

/**
 * Half-width of the shadow frustum, metres: the extent with a small margin, and with the site (`ctx`) at least as far as the
 * farthest site occluder (tree crowns, neighbour houses, fences) plus `SHADOW_OCCLUDER_MARGIN`, so whatever the sun analysis
 * counts also casts its shadow in the picture.
 */
export function shadowRangeFor(extent: SceneExtent, ctx?: Pick<HouseContext, "layout">): number {
  const base = extent.radius * SHADOW_MARGIN;
  if (!ctx) return base;
  const c: XY = [extent.center[0], extent.center[1]];
  const far = ctx.layout.occluders().reduce((m, o) => Math.max(m, occluderReach(o, c)), 0);
  return Math.max(base, far + SHADOW_OCCLUDER_MARGIN);
}
