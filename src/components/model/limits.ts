// The preset views must be reachable: the orbit limits come from the extent of the scene, but a view that stands in for an
// orthographic camera (a very long lens, far away) can lie beyond the default maximum distance and the fog of the scene.
// This module refits such a view to a shorter lens and widens the limits if a view still lies beyond them. Pure; no three.js.
import type { OrbitLimits, ResolvedView } from "@/lib/three/views";

/** Room beyond the farthest preset, so that the view is not pressed against the limit. */
export const VIEW_REACH_MARGIN = 1.05;

const distanceOf = (v: Pick<ResolvedView, "position" | "target">): number =>
  Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);

/** The limits, with the maximum distance widened (never narrowed) so that every view is within it. */
export function limitsForViews(base: OrbitLimits, views: readonly Pick<ResolvedView, "position" | "target">[]): OrbitLimits {
  const farthest = views.reduce((m, v) => Math.max(m, distanceOf(v)), 0);
  return { ...base, maxDistance: Math.max(base.maxDistance, farthest * VIEW_REACH_MARGIN) };
}

/** Field of view of the top view, degrees: long enough to look like a plan, short enough to stay inside the orbit limits and the fog. */
export const TOP_VIEW_FOV = 20;

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
  const position: [number, number, number] = [
    view.target[0] + (view.position[0] - view.target[0]) * k,
    view.target[1] + (view.position[1] - view.target[1]) * k,
    view.target[2] + (view.position[2] - view.target[2]) * k,
  ];
  return { ...view, position, fov };
}
