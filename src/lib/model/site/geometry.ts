// 2D geometry helpers for the plot model (pure TypeScript, no dependencies).
// Frame: house frame, metres, x = east, y = north (see docs/ARCHITECTURE.md).

export type XY = [number, number];
/** Axis-aligned rectangle [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export type Rect = [number, number, number, number];
export interface Bbox { x0: number; y0: number; x1: number; y1: number }

const DEG = Math.PI / 180;
export const deg2rad = (d: number): number => d * DEG;
export const rad2deg = (r: number): number => r / DEG;
export const mod360 = (a: number): number => ((a % 360) + 360) % 360;

export const dist = (a: XY, b: XY): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const lerp2 = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Signed area (positive for counter-clockwise rings, y up). */
export function signedArea(p: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
/** Polygon area by the shoelace formula (always >= 0). */
export const polygonArea = (p: readonly XY[]): number => Math.abs(signedArea(p));
export const ensureCcw = (p: readonly XY[]): XY[] => (signedArea(p) < 0 ? [...p].reverse() : [...p]);

export function polygonPerimeter(p: readonly XY[]): number {
  let l = 0;
  for (let i = 0; i < p.length; i++) l += dist(p[i], p[(i + 1) % p.length]);
  return l;
}

export function polygonCentroid(p: readonly XY[]): XY {
  const a6 = signedArea(p) * 6;
  if (Math.abs(a6) < 1e-12) return p.length ? [p[0][0], p[0][1]] : [0, 0];
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / a6, cy / a6];
}

export function bboxOf(points: readonly XY[]): Bbox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
export const expandBbox = (b: Bbox, m: number): Bbox => ({ x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m });
export const unionBbox = (a: Bbox, b: Bbox): Bbox => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

export const rectToPolygon = ([x0, y0, x1, y1]: Rect): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const rectArea = ([x0, y0, x1, y1]: Rect): number => (x1 - x0) * (y1 - y0);
export const expandRect = ([x0, y0, x1, y1]: Rect, m: number): Rect => [x0 - m, y0 - m, x1 + m, y1 + m];

/** Even-odd point-in-polygon test (points on the boundary may go either way). */
export function pointInPolygon(pt: XY, poly: readonly XY[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on segment a-b to q. */
export function nearestOnSegment(q: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
export const segDist = (q: XY, a: XY, b: XY): number => dist(q, nearestOnSegment(q, a, b));

/** Distance from q to the boundary of the polygon. */
export function distToBoundary(q: XY, poly: readonly XY[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(q, poly[i], poly[(i + 1) % poly.length]));
  return d;
}
/** Distance from q to the polygon as a solid (0 when inside). */
export const distToPolygon = (q: XY, poly: readonly XY[]): number => (pointInPolygon(q, poly) ? 0 : distToBoundary(q, poly));

/** Closest point on the boundary of the polygon to q. */
export function nearestOnPolygon(q: XY, poly: readonly XY[]): XY {
  let best: XY = poly[0] ?? q;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const n = nearestOnSegment(q, poly[i], poly[(i + 1) % poly.length]);
    const dn = dist(q, n);
    if (dn < d) {
      d = dn;
      best = n;
    }
  }
  return best;
}

/** Distance from q to a polyline (open). */
export function distToPolyline(q: XY, pts: readonly XY[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(q, pts[i], pts[i + 1]));
  return d;
}

export interface Closest { d: number; from: XY; to: XY }

/** Shortest distance between two segments with the closest points (a -> from, b -> to). */
export function segmentSegmentClosest(a1: XY, a2: XY, b1: XY, b2: XY): Closest {
  let best: Closest = { d: Infinity, from: a1, to: b1 };
  const offer = (from: XY, to: XY) => {
    const d = dist(from, to);
    if (d < best.d) best = { d, from, to };
  };
  if (segmentsIntersect(a1, a2, b1, b2)) {
    const p = segmentIntersection(a1, a2, b1, b2);
    if (p) return { d: 0, from: p, to: p };
  }
  // For disjoint segments the minimum is attained at an endpoint of one of them.
  offer(a1, nearestOnSegment(a1, b1, b2));
  offer(a2, nearestOnSegment(a2, b1, b2));
  offer(nearestOnSegment(b1, a1, a2), b1);
  offer(nearestOnSegment(b2, a1, a2), b2);
  return best;
}

/** Parameters (t along a1-a2, u along b1-b2) of the intersection of the infinite lines, or null when parallel. */
export function lineIntersectionParams(a1: XY, a2: XY, b1: XY, b2: XY): [number, number] | null {
  const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / den;
  return [t, u];
}
export function segmentIntersection(a1: XY, a2: XY, b1: XY, b2: XY): XY | null {
  const r = lineIntersectionParams(a1, a2, b1, b2);
  if (!r) return null;
  const [t, u] = r;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return lerp2(a1, a2, t);
}
export const segmentsIntersect = (a1: XY, a2: XY, b1: XY, b2: XY): boolean => segmentIntersection(a1, a2, b1, b2) !== null;

/** Shortest distance between two polygons' boundaries (0 if they overlap), with the closest points. */
export function polygonPolygonClosest(a: readonly XY[], b: readonly XY[]): Closest {
  let best: Closest = { d: Infinity, from: a[0], to: b[0] };
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const c = segmentSegmentClosest(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]);
      if (c.d < best.d) best = c;
    }
  }
  if (best.d > 0 && (pointInPolygon(a[0], b) || pointInPolygon(b[0], a))) return { d: 0, from: best.from, to: best.from };
  return best;
}

export const polylineLength = (pts: readonly XY[]): number => {
  let l = 0;
  for (let i = 0; i + 1 < pts.length; i++) l += dist(pts[i], pts[i + 1]);
  return l;
};

/** Point and unit tangent at arc length s along the polyline (clamped). */
export function pointAtLength(pts: readonly XY[], s: number): { p: XY; tangent: XY } {
  let rest = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = dist(pts[i], pts[i + 1]);
    if (rest <= l || i + 2 === pts.length) {
      const t = l ? Math.min(1, rest / l) : 0;
      return { p: lerp2(pts[i], pts[i + 1], t), tangent: l ? [(pts[i + 1][0] - pts[i][0]) / l, (pts[i + 1][1] - pts[i][1]) / l] : [1, 0] };
    }
    rest -= l;
  }
  return { p: pts[0] ?? [0, 0], tangent: [1, 0] };
}

/** Arc length of the point on the polyline closest to q. */
export function projectToPolyline(q: XY, pts: readonly XY[]): { s: number; d: number; p: XY } {
  let best = { s: 0, d: Infinity, p: pts[0] };
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = nearestOnSegment(q, a, b);
    const d = dist(q, n);
    if (d < best.d) best = { s: acc + dist(a, n), d, p: n };
    acc += dist(a, b);
  }
  return best;
}

/** Sub-polyline between arc lengths s0 and s1. */
export function subPolyline(pts: readonly XY[], s0: number, s1: number): XY[] {
  if (s1 <= s0) return [];
  const out: XY[] = [pointAtLength(pts, s0).p];
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    acc += dist(pts[i], pts[i + 1]);
    if (acc > s0 + 1e-9 && acc < s1 - 1e-9) out.push(pts[i + 1]);
  }
  out.push(pointAtLength(pts, s1).p);
  return out;
}

/**
 * Splits a polyline at the given polygon boundary crossings and keeps only parts inside `poly`.
 * Used to clip contour lines to the plot. Returns open polylines.
 */
export function clipPolylineToPolygon(pts: readonly XY[], poly: readonly XY[]): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  const flush = () => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const ts: number[] = [0, 1];
    for (let k = 0; k < poly.length; k++) {
      const r = lineIntersectionParams(a, b, poly[k], poly[(k + 1) % poly.length]);
      if (r && r[0] > 1e-12 && r[0] < 1 - 1e-12 && r[1] >= -1e-12 && r[1] <= 1 + 1e-12) ts.push(r[0]);
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p0 = lerp2(a, b, ts[k]), p1 = lerp2(a, b, ts[k + 1]);
      if (dist(p0, p1) < 1e-12) continue;
      const mid = lerp2(p0, p1, 0.5);
      if (pointInPolygon(mid, poly)) {
        if (!cur.length) cur.push(p0);
        else if (dist(cur[cur.length - 1], p0) > 1e-9) { flush(); cur.push(p0); }
        cur.push(p1);
      } else flush();
    }
  }
  flush();
  return out;
}

/** First hit of a ray (house azimuth, clockwise from +y) with the polygon boundary. */
export function rayToBoundary(origin: XY, houseAzimuthDeg: number, poly: readonly XY[]): { d: number; point: XY; edge: number } | null {
  const a = deg2rad(houseAzimuthDeg);
  const dir: XY = [Math.sin(a), Math.cos(a)];
  const far: XY = [origin[0] + dir[0] * 1e4, origin[1] + dir[1] * 1e4];
  let best: { d: number; point: XY; edge: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = segmentIntersection(origin, far, poly[i], poly[(i + 1) % poly.length]);
    if (!p) continue;
    const d = dist(origin, p);
    if (!best || d < best.d) best = { d, point: p, edge: i };
  }
  return best;
}

/** Outward unit normal of edge i for a counter-clockwise polygon (use ensureCcw first). */
export function edgeOutwardNormal(poly: readonly XY[], i: number): XY {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const l = dist(a, b) || 1;
  return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
}
export function edgeDirection(poly: readonly XY[], i: number): XY {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const l = dist(a, b) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

/** House azimuth (clockwise from +y, degrees) of a direction vector. */
export const azimuthOf = (v: XY): number => mod360(rad2deg(Math.atan2(v[0], v[1])));
/** Unit vector for a house azimuth. */
export const vectorOfAzimuth = (azDeg: number): XY => [Math.sin(deg2rad(azDeg)), Math.cos(deg2rad(azDeg))];

/** Converts a house azimuth to a true azimuth: (a + bearing) mod 360. */
export const houseToTrueAzimuth = (houseAz: number, houseAxisBearingDeg: number): number => mod360(houseAz + houseAxisBearingDeg);
export const trueToHouseAzimuth = (trueAz: number, houseAxisBearingDeg: number): number => mod360(trueAz - houseAxisBearingDeg);

/**
 * House frame (x east, y north) -> true compass frame (east, north), same origin.
 * The house +y axis points at azimuth `bearing` clockwise from true north.
 */
export function houseToTrueXY([x, y]: XY, bearingDeg: number): XY {
  const c = Math.cos(deg2rad(bearingDeg)), s = Math.sin(deg2rad(bearingDeg));
  return [x * c + y * s, -x * s + y * c];
}
export function trueToHouseXY([e, n]: XY, bearingDeg: number): XY {
  const c = Math.cos(deg2rad(bearingDeg)), s = Math.sin(deg2rad(bearingDeg));
  return [e * c - n * s, e * s + n * c];
}

/**
 * Inward offset of a convex or mildly non-convex counter-clockwise polygon with mitred corners.
 * Intended for plot boundaries (4-8 vertices); not a general-purpose offsetting routine.
 */
export function insetPolygon(poly: readonly XY[], d: number): XY[] {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const l = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l; // inward normal for CCW
    return { p: [a[0] + nx * d, a[1] + ny * d] as XY, q: [b[0] + nx * d, b[1] + ny * d] as XY };
  });
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i + n - 1) % n], cur = lines[i];
    const r = lineIntersectionParams(prev.p, prev.q, cur.p, cur.q);
    out.push(r ? lerp2(prev.p, prev.q, r[0]) : cur.p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Exact area of a union of polygons, optionally clipped by another polygon.
// Strip method: between consecutive abscissae (vertices and all edge crossings) the cross-section of every
// polygon is a fixed set of y-intervals that change linearly, so length at the strip mid-line times width is exact.

type Seg = [XY, XY];
const edgesOf = (p: readonly XY[]): Seg[] => p.map((a, i) => [a, p[(i + 1) % p.length]] as Seg);

function intervalsAt(poly: readonly XY[], x: number): [number, number][] {
  const ys: number[] = [];
  for (const [a, b] of edgesOf(poly)) {
    if (a[0] === b[0]) continue;
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    if (x < lo || x >= hi) continue;
    ys.push(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
  }
  ys.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]]);
  return out;
}
function mergeIntervals(iv: [number, number][]): [number, number][] {
  const s = [...iv].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
function intersectIntervals(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** Area of (union of `shapes`) intersected with `clip` (when given). Overlaps are counted once. */
export function unionArea(shapes: readonly (readonly XY[])[], clip?: readonly XY[]): number {
  const polys = shapes.filter((s) => s.length >= 3);
  if (!polys.length) return 0;
  const all = clip ? [...polys, clip] : polys;
  const segs = all.flatMap(edgesOf);
  const xs = new Set<number>();
  for (const [a, b] of segs) { xs.add(a[0]); xs.add(b[0]); }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segmentIntersection(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (p) xs.add(p[0]);
    }
  }
  const sorted = [...xs].sort((p, q) => p - q);
  let area = 0;
  for (let k = 0; k + 1 < sorted.length; k++) {
    const w = sorted[k + 1] - sorted[k];
    if (w < 1e-12) continue;
    const xm = (sorted[k] + sorted[k + 1]) / 2;
    let iv = mergeIntervals(polys.flatMap((p) => intervalsAt(p, xm)));
    if (clip) iv = intersectIntervals(iv, mergeIntervals(intervalsAt(clip, xm)));
    area += iv.reduce((s, [a, b]) => s + (b - a), 0) * w;
  }
  return area;
}

export const intersectionArea = (a: readonly XY[], b: readonly XY[]): number => unionArea([a], b);
