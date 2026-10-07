// Contour lines by marching squares on a height grid, polyline linking by edge ids, labels and clipping.
import { clipPolylineToPolygon, polylineLength, pointAtLength, type XY } from "./geometry";
import type { HeightGrid } from "./terrain";

export interface Contour {
  /** Height (m, relative to +-0.000). */
  level: number;
  /** True for the coarse interval (e.g. every 1 m). */
  major: boolean;
  /** Closed ring (first point is not repeated) or open line that starts and ends on the grid border. */
  closed: boolean;
  points: XY[];
}

export interface ContourOptions {
  /** Fine interval (m). Default 0.2. */
  minor?: number;
  /** Coarse interval (m), a multiple of the fine one. Default 1. */
  major?: number;
  /** Optional explicit range of levels to generate. */
  zMin?: number;
  zMax?: number;
}

const EPS = 1e-9;

/** Contours of a height grid at multiples of `minor`; levels that are multiples of `major` are flagged major. */
export function contourLines(g: HeightGrid, opts: ContourOptions = {}): Contour[] {
  const minor = opts.minor ?? 0.2;
  const major = opts.major ?? 1;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < g.z.length; k++) {
    const v = g.z[k];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  lo = Math.max(lo, opts.zMin ?? -Infinity);
  hi = Math.min(hi, opts.zMax ?? Infinity);
  const out: Contour[] = [];
  const first = Math.ceil(lo / minor - EPS), last = Math.floor(hi / minor + EPS);
  for (let n = first; n <= last; n++) {
    const level = Math.round(n * minor * 1e6) / 1e6;
    const isMajor = Math.abs(level / major - Math.round(level / major)) < 1e-6;
    for (const c of traceLevel(g, level)) out.push({ level, major: isMajor, closed: c.closed, points: c.points });
  }
  return out;
}

interface Seg { a: number; b: number }

function traceLevel(g: HeightGrid, level: number): { closed: boolean; points: XY[] }[] {
  const { nx, ny, step, x0, y0, z } = g;
  const above = (i: number, j: number) => z[j * nx + i] > level;
  // Edge ids: horizontal edge from node (i, j) to (i + 1, j) -> 2 * node; vertical edge (i, j) to (i, j + 1) -> 2 * node + 1.
  const H = (i: number, j: number) => 2 * (j * nx + i);
  const V = (i: number, j: number) => 2 * (j * nx + i) + 1;
  const segs: Seg[] = [];
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const b0 = above(i, j), b1 = above(i + 1, j), b2 = above(i + 1, j + 1), b3 = above(i, j + 1);
      if (b0 === b1 && b1 === b2 && b2 === b3) continue;
      const bottom = H(i, j), right = V(i + 1, j), top = H(i, j + 1), left = V(i, j);
      const cross: number[] = [];
      if (b0 !== b1) cross.push(bottom);
      if (b1 !== b2) cross.push(right);
      if (b2 !== b3) cross.push(top);
      if (b3 !== b0) cross.push(left);
      if (cross.length === 2) segs.push({ a: cross[0], b: cross[1] });
      else if (cross.length === 4) {
        // Saddle: decide by the cell centre value.
        const centre = (z[j * nx + i] + z[j * nx + i + 1] + z[(j + 1) * nx + i + 1] + z[(j + 1) * nx + i]) / 4 > level;
        const diagonalAbove = b0; // b0 === b2 !== b1 === b3 for a saddle
        const joinsDiagonal = centre === diagonalAbove;
        // Corners of the minority colour are cut off when the centre differs from the diagonal pair.
        if (joinsDiagonal) segs.push({ a: bottom, b: right }, { a: top, b: left });
        else segs.push({ a: bottom, b: left }, { a: right, b: top });
      }
    }
  }
  if (!segs.length) return [];

  const pointOf = new Map<number, XY>();
  const point = (id: number): XY => {
    let p = pointOf.get(id);
    if (p) return p;
    const node = id >> 1;
    const i = node % nx, j = (node - i) / nx;
    const vertical = (id & 1) === 1;
    const v0 = z[node], v1 = vertical ? z[node + nx] : z[node + 1];
    const t = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0);
    p = vertical ? [x0 + i * step, y0 + (j + t) * step] : [x0 + (i + t) * step, y0 + j * step];
    pointOf.set(id, p);
    return p;
  };

  const byEdge = new Map<number, number[]>();
  segs.forEach((s, k) => {
    for (const e of [s.a, s.b]) {
      const l = byEdge.get(e);
      if (l) l.push(k);
      else byEdge.set(e, [k]);
    }
  });
  const used = new Uint8Array(segs.length);
  const result: { closed: boolean; points: XY[] }[] = [];

  const walk = (startSeg: number, startEdge: number): { ids: number[]; closed: boolean } => {
    const ids = [startEdge];
    let seg = startSeg, edge = startEdge;
    for (;;) {
      used[seg] = 1;
      const s = segs[seg];
      const next = s.a === edge ? s.b : s.a;
      ids.push(next);
      const cand = (byEdge.get(next) ?? []).find((k) => !used[k]);
      if (cand === undefined) {
        const closed = next === startEdge;
        return { ids, closed };
      }
      seg = cand;
      edge = next;
    }
  };

  // Open lines first: they start at an edge that belongs to exactly one segment (grid border).
  for (const [edge, list] of byEdge) {
    if (list.length !== 1 || used[list[0]]) continue;
    const { ids } = walk(list[0], edge);
    result.push({ closed: false, points: ids.map(point) });
  }
  // Whatever is left are closed rings.
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    const { ids, closed } = walk(k, segs[k].a);
    const pts = ids.map(point);
    if (closed) pts.pop();
    result.push({ closed, points: pts });
  }
  return result;
}

/** Chaikin corner cutting. Open lines keep their end points. */
export function smoothPolyline(points: readonly XY[], closed: boolean, iterations = 1): XY[] {
  let p: XY[] = points.map((q) => [q[0], q[1]] as XY);
  for (let it = 0; it < iterations && p.length > 2; it++) {
    const out: XY[] = [];
    const n = p.length;
    const lim = closed ? n : n - 1;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < lim; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

/** Contours clipped to a polygon (e.g. the plot). Clipped pieces are open lines. */
export function clipContours(contours: readonly Contour[], polygon: readonly XY[]): Contour[] {
  const out: Contour[] = [];
  for (const c of contours) {
    const pts = c.closed ? [...c.points, c.points[0]] : c.points;
    for (const piece of clipPolylineToPolygon(pts, polygon)) {
      const ring = piece.length > 3 && Math.hypot(piece[0][0] - piece[piece.length - 1][0], piece[0][1] - piece[piece.length - 1][1]) < 1e-9;
      out.push({ level: c.level, major: c.major, closed: ring, points: ring ? piece.slice(0, -1) : piece });
    }
  }
  return out;
}

export interface ContourLabel {
  x: number;
  y: number;
  /** Text rotation (degrees, counter-clockwise, in (-90, 90] so the text is never upside down). */
  angleDeg: number;
  level: number;
  major: boolean;
  text: string;
}

export interface LabelOptions {
  /** Target distance between labels along one coarse (major) line (m). Default 30. */
  majorSpacing?: number;
  /** Same for fine lines; `Infinity` switches fine labels off. Default 60. */
  minorSpacing?: number;
  /** Labels closer than this to an earlier label are dropped (m). Default 10. */
  minSeparation?: number;
  /** Lines shorter than this get no label (m). Default 8. */
  minLength?: number;
  /** Height of the +-0.000 level above sea level (m), used by `style: "asl"`. */
  zeroLevelAsl?: number;
  /** "relative" prints +0.4 / -1.0 / +-0.0, "asl" prints the absolute height. */
  style?: "relative" | "asl";
  /** Custom formatter (e.g. Czech decimal comma via the i18n number formatter); receives the relative level. */
  format?: (relativeLevel: number, absoluteLevel: number | undefined) => string;
}

/**
 * Places labels along contour lines: every line long enough gets one label in the middle, longer lines get
 * evenly spaced ones (about one per `spacing` metres). Coarse lines are labelled first so they win clashes.
 * Deterministic.
 */
export function contourLabels(contours: readonly Contour[], opts: LabelOptions = {}): ContourLabel[] {
  const majorSpacing = opts.majorSpacing ?? 30;
  const minorSpacing = opts.minorSpacing ?? 60;
  const sep = opts.minSeparation ?? 10;
  const minLen = opts.minLength ?? 8;
  const style = opts.style ?? "relative";
  const fmt =
    opts.format ??
    ((rel: number, abs: number | undefined) => {
      if (style === "asl" && abs !== undefined) return abs.toFixed(1);
      const r = Math.round(rel * 10) / 10;
      return r === 0 ? "±0.0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
    });
  const out: ContourLabel[] = [];
  const ordered = [...contours].sort((a, b) => Number(b.major) - Number(a.major));
  for (const c of ordered) {
    const spacing = c.major ? majorSpacing : minorSpacing;
    if (!Number.isFinite(spacing)) continue;
    const pts = c.closed ? [...c.points, c.points[0]] : c.points;
    const len = polylineLength(pts);
    if (len < minLen) continue;
    const n = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k < n; k++) {
      const { p, tangent } = pointAtLength(pts, ((k + 0.5) * len) / n);
      if (out.some((l) => Math.hypot(l.x - p[0], l.y - p[1]) < sep)) continue;
      let ang = (Math.atan2(tangent[1], tangent[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      else if (ang <= -90) ang += 180;
      const abs = opts.zeroLevelAsl === undefined ? undefined : opts.zeroLevelAsl + c.level;
      out.push({ x: p[0], y: p[1], angleDeg: ang, level: c.level, major: c.major, text: fmt(c.level, abs) });
    }
  }
  return out;
}
