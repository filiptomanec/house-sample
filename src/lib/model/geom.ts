// Planar geometry helpers (pure, no DOM): axis-aligned rectangles, unions via coordinate compression,
// polygon utilities, wall helpers, furniture and door-swing footprints. House frame: x = east, y = north, metres.

export type Rect = [number, number, number, number]; // [x0, y0, x1, y1]
export type Pt = [number, number];
export type Pt3 = [number, number, number];
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  d: number;
}
export interface Poly {
  pts: Pt[];
  /** Signed area: positive = outer boundary (counter-clockwise), negative = hole. */
  area: number;
}

export const EPS = 1e-6;
/** Rounds to 5 decimals (0.01 mm): the snapping grid of all plan coordinates. */
export const R5 = (v: number): number => Math.round(v * 1e5) / 1e5;
export const round = (v: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

// ---------------------------------------------------------------- rectangles
export const rectArea = (r: Rect): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
export function rectInter(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}
export const interArea = (a: Rect, b: Rect): number => {
  const r = rectInter(a, b);
  return r ? rectArea(r) : 0;
};
export const expandRect = (r: Rect, d: number): Rect => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
export const inRect = (r: Rect, x: number, y: number, tol = 0): boolean =>
  x >= r[0] - tol && x <= r[2] + tol && y >= r[1] - tol && y <= r[3] + tol;
export const uniqSorted = (arr: number[]): number[] => [...new Set(arr.map(R5))].sort((a, b) => a - b);
const idxMap = (arr: number[]): Map<number, number> => new Map(arr.map((v, i) => [v, i]));
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-7;

export function bboxOf(rects: Rect[]): BBox | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r[0]));
  const y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[2]));
  const y1 = Math.max(...rects.map((r) => r[3]));
  return { x0, y0, x1, y1, w: x1 - x0, d: y1 - y0 };
}

/** Merges neighbouring rectangles that share a full side into larger ones. */
export function mergeRects(input: Rect[]): Rect[] {
  const rs = input.map((r) => r.slice() as Rect);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < rs.length; a++) {
      for (let b = a + 1; b < rs.length; b++) {
        const A = rs[a];
        const B = rs[b];
        if (near(A[1], B[1]) && near(A[3], B[3]) && (near(A[2], B[0]) || near(B[2], A[0]))) {
          rs[a] = [Math.min(A[0], B[0]), A[1], Math.max(A[2], B[2]), A[3]];
          rs.splice(b, 1);
          changed = true;
          break outer;
        }
        if (near(A[0], B[0]) && near(A[2], B[2]) && (near(A[3], B[1]) || near(B[3], A[1]))) {
          rs[a] = [A[0], Math.min(A[1], B[1]), A[2], Math.max(A[3], B[3])];
          rs.splice(b, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return rs;
}

export interface Union {
  rects: Rect[];
  area: number;
  polygons: Poly[];
  perimeter: number;
  bbox: BBox | null;
}

/** Union of rectangles via coordinate compression: area, a decomposition into rectangles, boundary polygons. */
export function unionOf(rects: Rect[]): Union {
  const rs = rects.filter((r) => r[2] > r[0] && r[3] > r[1]);
  if (!rs.length) return { rects: [], area: 0, polygons: [], perimeter: 0, bbox: null };
  const xs = uniqSorted(rs.flatMap((r) => [r[0], r[2]]));
  const ys = uniqSorted(rs.flatMap((r) => [r[1], r[3]]));
  const xi = idxMap(xs);
  const yi = idxMap(ys);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const cov = Array.from({ length: ny }, () => new Uint8Array(nx));
  for (const r of rs) {
    for (let j = yi.get(R5(r[1]))!; j < yi.get(R5(r[3]))!; j++) {
      for (let i = xi.get(R5(r[0]))!; i < xi.get(R5(r[2]))!; i++) cov[j][i] = 1;
    }
  }
  let area = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (cov[j][i]) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  // decomposition: runs along x, merged vertically
  interface Rec {
    i0: number;
    i1: number;
    j0: number;
    j1: number;
  }
  const out: Rec[] = [];
  let prev = new Map<string, Rec>();
  for (let j = 0; j < ny; j++) {
    const cur = new Map<string, Rec>();
    let i = 0;
    while (i < nx) {
      if (cov[j][i]) {
        let k = i;
        while (k < nx && cov[j][k]) k++;
        const key = `${i}-${k}`;
        let rec = prev.get(key);
        if (rec) rec.j1 = j + 1;
        else {
          rec = { i0: i, i1: k, j0: j, j1: j + 1 };
          out.push(rec);
        }
        cur.set(key, rec);
        i = k;
      } else i++;
    }
    prev = cur;
  }
  const rectsOut: Rect[] = out.map((o) => [xs[o.i0], ys[o.j0], xs[o.i1], ys[o.j1]]);
  const { polygons, perimeter } = tracePolygons(xs, ys, cov);
  return { rects: rectsOut, area, polygons, perimeter, bbox: bboxOf(rectsOut) };
}

interface TracedEdge {
  a: [number, number];
  b: [number, number];
  used: boolean;
}

function tracePolygons(xs: number[], ys: number[], cov: Uint8Array[]): { polygons: Poly[]; perimeter: number } {
  const ny = ys.length - 1;
  const nx = xs.length - 1;
  const c = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < ny && cov[j][i] === 1;
  const edges = new Map<string, TracedEdge[]>();
  const add = (a: [number, number], b: [number, number]): void => {
    const k = `${a[0]},${a[1]}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k)!.push({ a, b, used: false });
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!c(i, j)) continue;
      if (!c(i, j - 1)) add([i, j], [i + 1, j]);
      if (!c(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!c(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!c(i - 1, j)) add([i, j + 1], [i, j]);
    }
  }
  const polygons: Poly[] = [];
  let perimeter = 0;
  for (const list of edges.values()) {
    for (const e0 of list) {
      if (e0.used) continue;
      const pts: [number, number][] = [];
      let e = e0;
      for (let guard = 0; guard < 100000; guard++) {
        e.used = true;
        pts.push(e.a);
        if (e.b[0] === e0.a[0] && e.b[1] === e0.a[1]) break;
        const nxt = (edges.get(`${e.b[0]},${e.b[1]}`) ?? []).find((q) => !q.used);
        if (!nxt) break;
        e = nxt;
      }
      let coords: Pt[] = pts.map(([i, j]) => [xs[i], ys[j]]);
      // drop collinear points
      const all = coords;
      coords = all.filter((p, k) => {
        const a = all[(k + all.length - 1) % all.length];
        const b = all[(k + 1) % all.length];
        return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
      });
      let sa = 0;
      for (let k = 0; k < coords.length; k++) {
        const p = coords[k];
        const q = coords[(k + 1) % coords.length];
        sa += p[0] * q[1] - q[0] * p[1];
        perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      polygons.push({ pts: coords, area: sa / 2 });
    }
  }
  return { polygons, perimeter };
}

/** Part of `targets` that is not inside any of `covers` (covers are expanded by `tol`); returns area and merged rectangles. */
export function uncovered(targets: Rect[], covers: Rect[], tol = 0): { area: number; rects: Rect[] } {
  const cv = covers.map((r) => expandRect(r, tol));
  const all = [...targets, ...cv].filter((r) => r[2] > r[0] && r[3] > r[1]);
  if (!targets.length) return { area: 0, rects: [] };
  const xs = uniqSorted(all.flatMap((r) => [r[0], r[2]]));
  const ys = uniqSorted(all.flatMap((r) => [r[1], r[3]]));
  const bad: Rect[] = [];
  let area = 0;
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (targets.some((r) => inRect(r, cx, cy)) && !cv.some((r) => inRect(r, cx, cy))) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
        bad.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
      }
    }
  }
  return { area, rects: mergeRects(bad) };
}

// ---------------------------------------------------------------- polygons
/** Signed area (shoelace): positive for counter-clockwise rings. */
export function ringArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

export function ringCentroid(pts: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Signed distance from a point to the boundary of a set of rings (outer + holes, even-odd): positive inside. */
export function signedDistance(p: Pt, rings: Pt[][]): number {
  let inside = false;
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      min = Math.min(min, distToSegment(p, a, b));
    }
  }
  return (inside ? 1 : -1) * min;
}

export function pointInRing(p: Pt, ring: Pt[]): boolean {
  return signedDistance(p, [ring]) >= 0;
}

// ---------------------------------------------------------------- walls
export interface WallLike {
  orient: "h" | "v";
  at: number;
  from: number;
  to: number;
  t: number;
}

/** Half of the largest thickness of a perpendicular wall passing through (along, at): used at corners and T-junctions. */
export function perpHalfAt(walls: WallLike[], orient: "h" | "v", at: number, along: number): number {
  const po = orient === "h" ? "v" : "h";
  let m = 0;
  for (const w of walls) {
    if (w.orient !== po) continue;
    if (Math.abs(w.at - along) > 1e-6) continue;
    if (at < w.from - 1e-6 || at > w.to + 1e-6) continue;
    m = Math.max(m, w.t / 2);
  }
  return m;
}

/** Rectangle occupied by a wall including the half-thickness of perpendicular walls at both ends. */
export function wallBody(w: WallLike, walls: WallLike[]): Rect {
  const e0 = perpHalfAt(walls, w.orient, w.at, w.from);
  const e1 = perpHalfAt(walls, w.orient, w.at, w.to);
  return w.orient === "h"
    ? [w.from - e0, w.at - w.t / 2, w.to + e1, w.at + w.t / 2]
    : [w.at - w.t / 2, w.from - e0, w.at + w.t / 2, w.to + e1];
}

// ---------------------------------------------------------------- furniture and doors
export interface FurnitureBase {
  type: string;
  x: number;
  y: number;
  rot: number;
  w?: number;
  d?: number;
}

/** Axis-aligned footprint of a furniture item after rotation. `catalog` supplies default sizes. */
export function furnitureRect(
  item: FurnitureBase,
  catalog: Record<string, { w: number; d: number }>,
): { w: number; d: number; rect: Rect } {
  const base = catalog[item.type] ?? { w: 1, d: 1 };
  const w = item.w ?? base.w;
  const d = item.d ?? base.d;
  const swap = item.rot === 90 || item.rot === 270;
  const fw = swap ? d : w;
  const fd = swap ? w : d;
  return { w, d, rect: [item.x - fw / 2, item.y - fd / 2, item.x + fw / 2, item.y + fd / 2] };
}

export interface DoorSwing {
  hinge: Pt;
  leafEnd: Pt;
  closedEnd: Pt;
  radius: number;
  bbox: Rect;
}

export interface SwingOpening {
  kind: string;
  orient: "h" | "v";
  swing: "+" | "-" | null;
  hinge: "+" | "-" | null;
  w: number;
  /** Position along the wall. */
  c: number;
  /** Wall axis coordinate. */
  axis: number;
}

/** Area swept by a door leaf: a quarter circle centred on the hinge (on the wall face on the swing side). */
export function doorSwing(op: SwingOpening, wallT: number): DoorSwing | null {
  if (!op.swing || !op.hinge) return null;
  const sd = op.swing === "+" ? 1 : -1;
  const hd = op.hinge === "+" ? 1 : -1;
  const L = op.kind === "entry" ? Math.min(op.w, 0.9) : op.w;
  const hAlong = op.c + (hd * op.w) / 2;
  const faceOff = (sd * wallT) / 2;
  const toward = -hd;
  let hinge: Pt;
  let leafEnd: Pt;
  let closedEnd: Pt;
  if (op.orient === "h") {
    hinge = [hAlong, op.axis + faceOff];
    leafEnd = [hAlong, hinge[1] + sd * L];
    closedEnd = [hAlong + toward * L, hinge[1]];
  } else {
    hinge = [op.axis + faceOff, hAlong];
    leafEnd = [hinge[0] + sd * L, hAlong];
    closedEnd = [hinge[0], hAlong + toward * L];
  }
  const xs = [hinge[0], leafEnd[0], closedEnd[0]];
  const ys = [hinge[1], leafEnd[1], closedEnd[1]];
  return { hinge, leafEnd, closedEnd, radius: L, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Does a rectangle intersect the swept quarter circle (nearest-point test)? */
export function rectHitsSwing(rect: Rect, sw: DoorSwing): boolean {
  const q = rectInter(rect, sw.bbox);
  if (!q) return false;
  const px = Math.min(Math.max(sw.hinge[0], q[0]), q[2]);
  const py = Math.min(Math.max(sw.hinge[1], q[1]), q[3]);
  return Math.hypot(px - sw.hinge[0], py - sw.hinge[1]) < sw.radius - 1e-6;
}

// ---------------------------------------------------------------- orientation helpers
export const FACING_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** True azimuth of a house-frame azimuth. */
export const trueAzimuth = (houseAz: number, bearing: number): number => ((houseAz + bearing) % 360 + 360) % 360;

/** 8-wind compass name of an azimuth in degrees. */
export const facing8 = (az: number): (typeof FACING_NAMES)[number] => FACING_NAMES[Math.round((((az % 360) + 360) % 360) / 45) % 8];
