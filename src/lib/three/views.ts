// Camera views of the 3D engine, from `house.cameras` (docs/HOUSE-FORMAT.md section 4.6). Pure, no three.js.
//
// The viewer renders every view with one perspective camera. An orthographic camera of the model (the "top view") is
// approximated by a long lens: same direction and target, the distance chosen so that the visible height at the target
// equals `orthoHeight`. The difference to a true orthographic projection is below the width of a line at this field of view.
import type { Camera } from "@/lib/model";
import { toScene, type Vec3 } from "./frame";

/** Field of view (degrees) that replaces an orthographic projection. */
export const ORTHO_APPROX_FOV = 6;

/** A view ready for the viewer: scene-frame position and target (Y-up) and a vertical field of view. */
export interface ResolvedView {
  /** Id of the camera in `house.cameras` (a label for the UI and for URLs; never branch on it). */
  id: string;
  /** Bilingual name from the model. */
  name: Camera["name"];
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** True when this view stands in for an orthographic camera. */
  ortho: boolean;
}

/** Distance from the target at which a perspective camera with `fov` sees `height` metres at the target. */
export function distanceForVisibleHeight(height: number, fovDeg: number): number {
  return height / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/** Converts a model camera (house frame) into a view (scene frame, perspective only). */
export function resolveView(cam: Camera): ResolvedView {
  const position = toScene(cam.position), target = toScene(cam.target);
  if (cam.kind === "perspective") return { id: cam.id, name: cam.name, position, target, fov: cam.fov ?? 40, ortho: false };
  const dir: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const len = Math.hypot(...dir) || 1;
  const d = distanceForVisibleHeight(cam.orthoHeight ?? 10, ORTHO_APPROX_FOV);
  return {
    id: cam.id, name: cam.name, target, fov: ORTHO_APPROX_FOV, ortho: true,
    position: [target[0] + (dir[0] / len) * d, target[1] + (dir[1] / len) * d, target[2] + (dir[2] / len) * d],
  };
}

/** The cameras meant for a use ("web" for the viewer presets, "render" for stills, "og" for the share image), in model order. */
export function camerasFor(cameras: readonly Camera[], use: Camera["use"][number] = "web"): Camera[] {
  return cameras.filter((c) => c.use.includes(use));
}

/** Resolved web views in model order. */
export function webViews(cameras: readonly Camera[]): ResolvedView[] {
  return camerasFor(cameras, "web").map(resolveView);
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

/** The shadow frustum covers the extent with a small margin (the sun shadow camera is orthographic). */
export const SHADOW_MARGIN = 1.1;

/** Half-width of the shadow frustum for an extent, metres. */
export const shadowRangeFor = (extent: SceneExtent): number => extent.radius * SHADOW_MARGIN;
