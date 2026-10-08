// Framing checks of the render cameras, shared by the tests and scripts/render-preview.mjs: the share of the frame width the
// house covers, where a point or a crown lands on the image, whether a ray meets the house, a crown or a fence, and whether
// the title zone of the hero is sky or roof. Pure TypeScript over the derived model and the kernel's occluders
// (`site.withHouse(outdoor).occluders()`), so a model change that blocks a view fails a test before any render.
import type { Derived } from "../../src/lib/model";
import { prismOf, rayChord, type Occluder, type SiteDerived, type XY } from "../../src/lib/model/site";
import { add, cross, dot, norm, project, scale, sub, type ResolvedCamera } from "./render-camera";
import type { Vec3 } from "./render-schema";
import type { GateState } from "./render-types";

export interface HouseShape {
  /** Outline of the walls (counter-clockwise) and the height up to which they are solid (the eave line). */
  outline: XY[];
  wallTop: number;
  /** Roof planes as 3D polygons (every eave corner and ridge point of the roof). */
  roofPlanes: Vec3[][];
}

export function houseShape(derived: Derived): HouseShape {
  return {
    outline: derived.outline.polygons[0].pts as XY[],
    wallTop: Math.min(...derived.roofs.map((r) => r.eaveHeight)),
    roofPlanes: derived.roofPlanes.map((p) => p.pts3 as Vec3[]),
  };
}

/** Points of the house silhouette: every roof-plane corner (eaves and ridges) and the outline at the floor. */
export function houseSilhouette(h: HouseShape): Vec3[] {
  return [...h.roofPlanes.flat(), ...h.outline.map(([x, y]) => [x, y, 0] as Vec3)];
}

/** Share of the frame width covered by the projected points (clipped to the frame); 0 when nothing is in front. */
export function widthShare(cam: ResolvedCamera, size: readonly [number, number], pts: readonly Vec3[]): number {
  const xs = pts.map((p) => project(cam, size, p)).filter((p) => p !== null).map((p) => p.x);
  if (!xs.length) return 0;
  const lo = Math.max(-1, Math.min(...xs)), hi = Math.min(1, Math.max(...xs));
  return Math.max(0, (hi - lo) / 2);
}

/** Direction of the ray through the image point (ndc x, y in -1..1) of a camera (the inverse of `project`). */
export function rayThrough(cam: ResolvedCamera, size: readonly [number, number], x: number, y: number): Vec3 {
  const f = cam.forward;
  const right = norm(cross(f, cam.up));
  const up = cross(right, f);
  const [w, h] = size;
  const L = Math.max(w, h);
  const longTan = cam.sensorWidthMm / (2 * cam.focalMm);
  const u = (x * w) / L + 2 * cam.shift[0];
  const v = (y * h) / L + 2 * cam.shift[1];
  return norm(add(f, add(scale(right, u * longTan), scale(up, v * longTan))));
}

function pointInPoly(x: number, y: number, poly: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** First hit of a ray with the house (walls up to the eave line, roof planes), or null. `dir` is a unit vector. */
export function rayHitsHouse(h: HouseShape, origin: Vec3, dir: Vec3, maxT = 1e4): { t: number; kind: "wall" | "roof" } | null {
  let best: { t: number; kind: "wall" | "roof" } | null = null;
  const n = h.outline.length;
  for (let i = 0; i < n; i++) {
    const a = h.outline[i], b = h.outline[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - origin[0]) * ey - (a[1] - origin[1]) * ex) / den;
    const s = ((a[0] - origin[0]) * dir[1] - (a[1] - origin[1]) * dir[0]) / den;
    if (t <= 1e-6 || t > maxT || s < 0 || s > 1) continue;
    const z = origin[2] + dir[2] * t;
    if (z < 0 || z > h.wallTop) continue;
    if (!best || t < best.t) best = { t, kind: "wall" };
  }
  for (const poly of h.roofPlanes) {
    const nrm = cross(sub(poly[1], poly[0]), sub(poly[2], poly[0]));
    const den = dot(nrm, dir);
    if (Math.abs(den) < 1e-12) continue;
    const t = dot(nrm, sub(poly[0], origin)) / den;
    if (t <= 1e-6 || t > maxT || (best && t >= best.t)) continue;
    const p = add(origin, scale(dir, t));
    if (pointInPoly(p[0], p[1], poly)) best = { t, kind: "roof" };
  }
  return best;
}

/** Is the point inside the house volume (below the eave line inside the outline)? */
export const insideHouse = (h: HouseShape, p: Vec3): boolean => p[2] >= 0 && p[2] <= h.wallTop && pointInPoly(p[0], p[1], h.outline);

/** Occluders that contain the point (or come closer than `clearance`). */
export function containing(occluders: readonly Occluder[], p: Vec3, clearance = 0): Occluder[] {
  const probes: Vec3[] = [p];
  if (clearance > 0) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) probes.push(add(p, scale(d, clearance)));
  return occluders.filter((o) => probes.some((q) => {
    const c = rayChord(o, q, [0, 0, 1]);
    return !!c && c.tIn === 0 && c.tOut > 1e-9;
  }));
}

/** The occluders met by the segment from `a` to `b` with a chord longer than `minChord` (the last `endGap` metres before `b` are free). */
export function blockers(occluders: readonly Occluder[], a: Vec3, b: Vec3, minChord = 0.05, endGap = 0): Occluder[] {
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1], d[2]);
  const u = scale(d, 1 / len);
  const stop = len - endGap;
  return occluders.filter((o) => {
    const c = rayChord(o, a, u);
    return !!c && Math.min(c.tOut, stop) - c.tIn > minChord;
  });
}

/**
 * Share (0..1) of the sample points hidden from `from`: by an occluder of the given roles (a chord longer than `minChord`) or,
 * with `house`, by the house itself (the last 0.3 m before a point are ignored, so a point on a facade is not hidden by it).
 */
export function hiddenShare(from: Vec3, points: readonly Vec3[], occluders: readonly Occluder[], opts: { minChord?: number; house?: HouseShape; ignore?: string } = {}): number {
  if (!points.length) return 0;
  if (opts.ignore) occluders = occluders.filter((o) => o.id !== opts.ignore);
  let hidden = 0;
  for (const p of points) {
    const d = sub(p, from);
    const len = Math.hypot(d[0], d[1], d[2]);
    const u = scale(d, 1 / len);
    let blocked = blockers(occluders, from, p, opts.minChord ?? 0.3, 0.2).length > 0;
    if (!blocked && opts.house) {
      const hit = rayHitsHouse(opts.house, from, u, len - 0.3);
      blocked = hit !== null;
    }
    if (blocked) hidden++;
  }
  return hidden / points.length;
}

/** Points on the surface of a crown ellipsoid (for its silhouette on the image). */
export function crownPoints(t: { x: number; y: number; z: number; height: number; crown: number; crownBase: number }, n = 16): Vec3[] {
  const cz = t.z + t.crownBase + (t.height - t.crownBase) / 2;
  const rz = (t.height - t.crownBase) / 2, r = t.crown / 2;
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = (Math.PI * i) / n - Math.PI / 2;
    for (let j = 0; j < 2 * n; j++) {
      const th = (Math.PI * j) / n;
      out.push([t.x + r * Math.cos(phi) * Math.cos(th), t.y + r * Math.cos(phi) * Math.sin(th), cz + rz * Math.sin(phi)]);
    }
  }
  return out;
}

/** Where a crown lands on the image: the extent of its points that fall inside the frame, or null when none does. */
export function crownOnImage(cam: ResolvedCamera, size: readonly [number, number], tree: Parameters<typeof crownPoints>[0]): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const ps = crownPoints(tree).map((p) => project(cam, size, p)).filter((p) => p !== null && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1) as { x: number; y: number }[];
  if (!ps.length) return null;
  return { xMin: Math.min(...ps.map((p) => p.x)), xMax: Math.max(...ps.map((p) => p.x)), yMin: Math.min(...ps.map((p) => p.y)), yMax: Math.max(...ps.map((p) => p.y)) };
}

/** What a ray through the image meets first: the house roof or wall, a site occluder (by role), the ground, or the sky. */
export function firstHit(cam: ResolvedCamera, size: readonly [number, number], x: number, y: number, house: HouseShape, occluders: readonly Occluder[], groundZ: number): string {
  const dir = rayThrough(cam, size, x, y);
  const o = cam.position;
  let bestT = Infinity, what = "sky";
  const h = rayHitsHouse(house, o, dir);
  if (h) { bestT = h.t; what = h.kind; }
  for (const occ of occluders) {
    const c = rayChord(occ, o, dir);
    if (c && c.tOut - c.tIn > 0.05 && c.tIn < bestT) { bestT = c.tIn; what = occ.role; }
  }
  if (dir[2] < -1e-9) {
    const t = (groundZ - o[2]) / dir[2];
    if (t > 0 && t < bestT) { bestT = t; what = "ground"; }
  }
  return what;
}

/** Share of a grid of rays through an image zone that meet only sky or roof (the title of the hero sits there). */
export function zoneSkyOrRoof(cam: ResolvedCamera, size: readonly [number, number], zone: { x0: number; x1: number; y0: number; y1: number }, house: HouseShape, occluders: readonly Occluder[], groundZ: number, n = 8): { share: number; hits: Record<string, number> } {
  const hits: Record<string, number> = {};
  let ok = 0, total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = zone.x0 + ((zone.x1 - zone.x0) * (i + 0.5)) / n;
      const y = zone.y0 + ((zone.y1 - zone.y0) * (j + 0.5)) / n;
      const w = firstHit(cam, size, x, y, house, occluders, groundZ);
      hits[w] = (hits[w] ?? 0) + 1;
      if (w === "sky" || w === "roof") ok++;
      total++;
    }
  }
  return { share: ok / total, hits };
}

/**
 * The occluders of a shot: the closed gate leaves of the site are replaced by their position at the shot's open fraction
 * (a sliding leaf moves along its park span, a swing leaf turns about its hinge into the plot).
 */
export function occludersWithGates(base: readonly Occluder[], gates: SiteDerived["gates"], state: GateState, groundAt: (x: number, y: number) => number): Occluder[] {
  const ids = new Set(gates.map((g) => g.id));
  // the leaf prisms are the only occluders that carry a gate's id (fence parts carry the fence's, pillars their own)
  const out = base.filter((o) => !(o.role === "fence" && ids.has(o.id)));
  for (const g of gates) {
    const t = g.access === "driveway" ? state.driveway : state.walkway;
    let leaf: XY[] = g.leafPolygon;
    if (t > 0 && g.park) {
      const dx = g.park.to[0] - g.park.from[0], dy = g.park.to[1] - g.park.from[1];
      const l = Math.hypot(dx, dy) || 1;
      leaf = leaf.map(([x, y]) => [x + (dx / l) * g.leaf * t, y + (dy / l) * g.leaf * t] as XY);
    } else if (t > 0 && g.swing) {
      const [hx, hy] = g.swing.hinge;
      const a0 = Math.atan2(g.swing.closedEnd[1] - hy, g.swing.closedEnd[0] - hx);
      const a1 = Math.atan2(g.swing.openEnd[1] - hy, g.swing.openEnd[0] - hx);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const c = Math.cos(da * t), s = Math.sin(da * t);
      leaf = leaf.map(([x, y]) => [hx + (x - hx) * c - (y - hy) * s, hy + (x - hx) * s + (y - hy) * c] as XY);
    }
    const zs = leaf.map((p) => groundAt(p[0], p[1]));
    out.push(prismOf(leaf, Math.min(...zs), Math.max(...zs) + g.height, { id: g.id, role: "fence" }));
  }
  return out;
}

/**
 * Sample points on the outside of the house: along every wall of the outline every `step` metres at two heights, and on every
 * roof plane (its centroid and the midpoints towards its corners), each 5 cm off the surface, with the surface normal.
 */
export function houseSamples(h: HouseShape, step = 2.5): { p: Vec3; n: Vec3 }[] {
  const out: { p: Vec3; n: Vec3 }[] = [];
  const pts = h.outline;
  // counter-clockwise ring: the outward normal of edge a->b is (dy, -dx)
  const ccw = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) > 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
    if (!ccw) { nx = -nx; ny = -ny; }
    const k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k;
      for (const z of [0.8, Math.max(1.2, h.wallTop - 0.6)]) out.push({ p: [a[0] + (b[0] - a[0]) * t + nx * 0.05, a[1] + (b[1] - a[1]) * t + ny * 0.05, z], n: [nx, ny, 0] });
    }
  }
  for (const poly of h.roofPlanes) {
    const c = poly.reduce<Vec3>((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length, s[2] + p[2] / poly.length], [0, 0, 0]);
    let n = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
    if (n[2] < 0) n = scale(n, -1);
    for (const q of [c, ...poly.map((p) => scale(add(p, c), 0.5))]) out.push({ p: add(q, scale(n, 0.05)), n });
  }
  return out;
}

/**
 * Share (0..1) of the house surface seen from `from` that is hidden behind the given occluders (tree crowns): of the sample
 * points facing the camera and not hidden by the house itself, the share whose ray meets an occluder (chord > `minChord`).
 */
export function occludedHouseShare(from: Vec3, samples: readonly { p: Vec3; n: Vec3 }[], h: HouseShape, occluders: readonly Occluder[], minChord = 0.5): number {
  let seen = 0, hidden = 0;
  for (const s of samples) {
    const d = sub(s.p, from);
    if (dot(d, s.n) >= 0) continue; // facing away
    const len = Math.hypot(d[0], d[1], d[2]);
    const u = scale(d, 1 / len);
    if (rayHitsHouse(h, from, u, len - 0.2)) continue; // behind another part of the house
    seen++;
    if (blockers(occluders, from, s.p, minChord, 0.2).length) hidden++;
  }
  return seen ? hidden / seen : 0;
}
