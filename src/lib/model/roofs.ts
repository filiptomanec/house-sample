// Roof geometry: every hip roof is decomposed into four planes; where roofs overlap, the lower surface is cut away
// (the visible surface is the maximum of all roofs, so valleys appear on their own). The result is a list of CONVEX
// polygon faces with 3D vertices, slope, azimuth, area, local (u, v) coordinates and typed edges.
import { DIR_AZIMUTH, type Dir, type EdgeKind } from "./catalog";
import { facing8, ringArea, ringCentroid, round, trueAzimuth, type Pt, type Pt3, type Rect } from "./geom";
import type { RoofEdge, RoofFace, RoofFrame } from "./types";

export interface RoofInput {
  id: string;
  /** Outer faces of the walls (the eaves lie `overhang` further out). */
  rect: Rect;
  /** Pitch, degrees. */
  pitch: number;
  overhang: number;
  /** Height of the roof plane above the wall face, m (top of the wall). */
  wallTop: number;
}

const DEG = Math.PI / 180;
const TOL = 1e-9;
/** Order of the sides of a roof; also the order of the planes in the output. */
export const ROOF_SIDES: readonly Dir[] = ["S", "E", "N", "W"];

// ---------------------------------------------------------------- planes
interface Plane {
  roof: number;
  side: Dir;
  /** z = a x + b y + c over the plan. */
  a: number;
  b: number;
  c: number;
}

/** Distance of a point from the side line of a roof, positive inside the rectangle. */
function sideDistance(r: RoofInput, side: Dir): { a: number; b: number; c: number } {
  const [x0, y0, x1, y1] = r.rect;
  switch (side) {
    case "S":
      return { a: 0, b: 1, c: -y0 };
    case "N":
      return { a: 0, b: -1, c: y1 };
    case "W":
      return { a: 1, b: 0, c: -x0 };
    case "E":
      return { a: -1, b: 0, c: x1 };
  }
}

function planeOf(roofs: RoofInput[], k: number, side: Dir): Plane {
  const r = roofs[k];
  const t = Math.tan(r.pitch * DEG);
  const d = sideDistance(r, side);
  return { roof: k, side, a: t * d.a, b: t * d.b, c: r.wallTop + t * d.c };
}

// ---------------------------------------------------------------- convex polygons with tagged edges
interface HalfPlane {
  /** Inside: a x + b y + c >= 0 (normalised so that hypot(a, b) = 1). */
  a: number;
  b: number;
  c: number;
}
/** Convex polygon, counter-clockwise; tags[i] describes the edge from pts[i] to pts[i + 1]. */
interface TPoly {
  pts: Pt[];
  tags: string[];
}

function normalise(a: number, b: number, c: number): HalfPlane | null {
  const g = Math.hypot(a, b);
  return g < 1e-12 ? null : { a: a / g, b: b / g, c: c / g };
}

const evalHp = (hp: HalfPlane, p: Pt): number => hp.a * p[0] + hp.b * p[1] + hp.c;
const negate = (hp: HalfPlane): HalfPlane => ({ a: -hp.a, b: -hp.b, c: -hp.c });

function tidy(poly: TPoly): TPoly | null {
  let pts = poly.pts;
  let tags = poly.tags;
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) < TOL) {
        // zero-length edge: drop its start vertex together with its tag
        pts = pts.filter((_, k) => k !== i);
        tags = tags.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let i = 0; i < pts.length; i++) {
      const n2 = pts.length;
      const a = pts[(i + n2 - 1) % n2];
      const p = pts[i];
      const b = pts[(i + 1) % n2];
      const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      if (Math.abs(cross) < 1e-12 && tags[(i + n2 - 1) % n2] === tags[i]) {
        pts = pts.filter((_, k) => k !== i);
        tags = tags.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3 || Math.abs(ringArea(pts)) < 1e-9) return null;
  return { pts, tags };
}

/** Keeps the part of a convex polygon where the half-plane holds; the new edge on the clip line gets `newTag`. */
function clip(poly: TPoly, hp: HalfPlane, newTag: string): TPoly | null {
  const n = poly.pts.length;
  const f = poly.pts.map((p) => evalHp(hp, p));
  if (f.every((v) => v >= -TOL)) return poly;
  if (f.every((v) => v <= TOL)) return null;
  const pts: Pt[] = [];
  const tags: string[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const fi = f[i];
    const fj = f[j];
    const inI = fi >= -TOL;
    const inJ = fj >= -TOL;
    const P = poly.pts[i];
    const Q = poly.pts[j];
    const cut = (): Pt => {
      const t = fi / (fi - fj);
      return [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
    };
    if (inI) {
      pts.push(P);
      tags.push(poly.tags[i]);
      if (!inJ) {
        pts.push(cut());
        tags.push(newTag);
      }
    } else if (inJ) {
      pts.push(cut());
      tags.push(poly.tags[i]);
    }
  }
  return tidy({ pts, tags });
}

const rectPoly = (r: Rect, tag: string): TPoly => ({
  pts: [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
  ],
  tags: [tag, tag, tag, tag],
});

/** Half-plane to the left of the directed edge a -> b (the inside of a counter-clockwise polygon). */
const leftOf = (a: Pt, b: Pt): HalfPlane => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  // cross((dx,dy), (px - ax, py - ay)) / l = (dx (py - ay) - dy (px - ax)) / l
  return { a: -dy / l, b: dx / l, c: (dy * a[0] - dx * a[1]) / l };
};

/** Part of the segment A-B (on a line) that lies inside the convex polygon R (tolerance 1e-7): parameter interval or null. */
function segmentInside(A: Pt, B: Pt, R: Pt[]): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const tol = 1e-7;
  for (let i = 0; i < R.length; i++) {
    const hp = leftOf(R[i], R[(i + 1) % R.length]);
    const f0 = evalHp(hp, A);
    const f1 = evalHp(hp, B);
    const df = f1 - f0;
    if (Math.abs(df) < 1e-12) {
      if (f0 < -tol) return null;
      continue;
    }
    const t = (-tol - f0) / df;
    if (df > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

/**
 * P minus C for convex P and C: disjoint convex pieces. Pieces are split along the edges of C; the new edges are
 * tagged with the kind of the cutter's edge where they border the cutter and "seam" where they border another piece.
 */
function subtractConvex(P: TPoly, C: TPoly): TPoly[] {
  const m = C.pts.length;
  // R = P ∩ C; its edges lying on the cutter carry the tag "cut:<kind>"
  let inter: TPoly | null = P;
  for (let i = 0; i < m; i++) {
    inter = clip(inter, leftOf(C.pts[i], C.pts[(i + 1) % m]), `cut:${C.tags[i]}`);
    if (!inter) return [P];
  }
  const R = inter;
  const pieces: TPoly[] = [];
  let rest: TPoly = P;
  for (let i = 0; i < R.pts.length && rest; i++) {
    if (!R.tags[i].startsWith("cut:")) continue; // an edge of P itself: nothing to split off
    const hp = leftOf(R.pts[i], R.pts[(i + 1) % R.pts.length]);
    const out = clip(rest, negate(hp), R.tags[i]);
    if (out) pieces.push(out);
    const inn = clip(rest, hp, "seam");
    if (!inn) break;
    rest = inn;
  }
  // edges along the cutter are real only where they touch R; elsewhere they border a neighbouring piece
  return pieces.map((pc) => splitCutEdges(pc, R.pts)).filter((x): x is TPoly => x !== null);
}

function splitCutEdges(pc: TPoly, R: Pt[]): TPoly | null {
  const pts: Pt[] = [];
  const tags: string[] = [];
  const n = pc.pts.length;
  for (let i = 0; i < n; i++) {
    const A = pc.pts[i];
    const B = pc.pts[(i + 1) % n];
    const tag = pc.tags[i];
    if (!tag.startsWith("cut:")) {
      pts.push(A);
      tags.push(tag);
      continue;
    }
    const kind = tag.slice(4);
    const span = segmentInside(A, B, R);
    const lerp = (t: number): Pt => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    if (!span) {
      pts.push(A);
      tags.push("seam");
      continue;
    }
    const [t0, t1] = span;
    pts.push(A);
    if (t0 > 1e-9) {
      tags.push("seam");
      pts.push(lerp(t0));
    }
    tags.push(kind);
    if (t1 < 1 - 1e-9) {
      pts.push(lerp(t1));
      tags.push("seam");
    }
  }
  return tidy({ pts, tags });
}

// ---------------------------------------------------------------- decomposition
/** The part of the plane (k, side) that is visible: the cell of the plane inside its roof, minus everything where another roof is higher. */
function visiblePieces(roofs: RoofInput[], k: number, side: Dir): TPoly[] {
  const r = roofs[k];
  const o = r.overhang;
  const dSelf = sideDistance(r, side);
  // cell: eave rectangle clipped by d_side <= d_other for the three other sides
  let cell: TPoly | null = rectPoly([r.rect[0] - o, r.rect[1] - o, r.rect[2] + o, r.rect[3] + o], "eave");
  for (const other of ROOF_SIDES) {
    if (other === side || !cell) continue;
    const dO = sideDistance(r, other);
    const hp = normalise(dO.a - dSelf.a, dO.b - dSelf.b, dO.c - dSelf.c);
    if (!hp) continue;
    cell = clip(cell, hp, `cell:${other}`);
  }
  if (!cell) return [];
  const own = planeOf(roofs, k, side);
  let pieces: TPoly[] = [cell];
  for (let j = 0; j < roofs.length; j++) {
    if (j === k) continue;
    const cutter = cutterRegion(roofs, j, own, k);
    if (!cutter) continue;
    pieces = pieces.flatMap((p) => subtractConvex(p, cutter));
  }
  return pieces;
}

/** Region where roof j is higher than the given plane: its eave rectangle clipped by "each plane of j above the plane". */
function cutterRegion(roofs: RoofInput[], j: number, own: Plane, k: number): TPoly | null {
  const rj = roofs[j];
  const oj = rj.overhang;
  let region: TPoly | null = rectPoly([rj.rect[0] - oj, rj.rect[1] - oj, rj.rect[2] + oj, rj.rect[3] + oj], "step");
  for (const side of ROOF_SIDES) {
    const pj = planeOf(roofs, j, side);
    const da = pj.a - own.a;
    const db = pj.b - own.b;
    const dc = pj.c - own.c;
    const hp = normalise(da, db, dc);
    if (!hp) {
      // parallel planes: either everywhere above, everywhere below, or coplanar (the later roof wins)
      if (dc < -TOL) return null;
      if (dc > TOL) continue;
      if (j < k) return null;
      continue;
    }
    if (!region) return null;
    region = clip(region, hp, "valley");
    if (!region) return null;
  }
  return region;
}

// ---------------------------------------------------------------- faces
const KIND_OF_TAG = (tag: string, side: Dir): EdgeKind => {
  if (tag.startsWith("cell:")) {
    const other = tag.slice(5) as Dir;
    // opposite sides meet at the ridge, adjacent sides at a hip
    return (ROOF_SIDES.indexOf(other) - ROOF_SIDES.indexOf(side) + 4) % 4 === 2 ? "ridge" : "hip";
  }
  return tag as EdgeKind;
};

const cross3 = (a: Pt3, b: Pt3): Pt3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Pt3, b: Pt3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Pt3, b: Pt3): Pt3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function frameOf(roofs: RoofInput[], k: number, side: Dir): RoofFrame {
  const r = roofs[k];
  const o = r.overhang;
  const t = r.pitch * DEG;
  const down: Pt = side === "S" ? [0, -1] : side === "N" ? [0, 1] : side === "W" ? [-1, 0] : [1, 0];
  const u: Pt3 = [-down[1], down[0], 0];
  const v: Pt3 = [-down[0] * Math.cos(t), -down[1] * Math.cos(t), Math.sin(t)];
  const zEave = r.wallTop - o * Math.tan(t);
  const origin: Pt3 =
    side === "S" ? [0, r.rect[1] - o, zEave] : side === "N" ? [0, r.rect[3] + o, zEave] : side === "W" ? [r.rect[0] - o, 0, zEave] : [r.rect[2] + o, 0, zEave];
  return { origin, u, v, n: cross3(u, v) };
}

/**
 * Builds the convex faces of all roofs. Faces of one plane are ordered by area (largest first); planes are ordered by
 * roof, then S, E, N, W.
 */
export function buildRoofFaces(roofs: RoofInput[], bearingDeg: number): RoofFace[] {
  const faces: RoofFace[] = [];
  for (let k = 0; k < roofs.length; k++) {
    const r = roofs[k];
    for (const side of ROOF_SIDES) {
      const plane = planeOf(roofs, k, side);
      const frame = frameOf(roofs, k, side);
      const pieces = visiblePieces(roofs, k, side)
        .map((p) => ({ p, area: Math.abs(ringArea(p.pts)) }))
        .sort((x, y) => y.area - x.area);
      const planeId = `${r.id}.${side}`;
      pieces.forEach(({ p }, idx) => {
        const pts = p.pts;
        const pts3: Pt3[] = pts.map(([x, y]) => [x, y, plane.a * x + plane.b * y + plane.c]);
        const uv: Pt[] = pts3.map((q) => {
          const d = sub3(q, frame.origin);
          return [round(dot3(d, frame.u), 9), round(dot3(d, frame.v), 9)];
        });
        const edges: RoofEdge[] = pts3.map((q, i) => {
          const w = pts3[(i + 1) % pts3.length];
          return { kind: KIND_OF_TAG(p.tags[i], side), length: Math.hypot(w[0] - q[0], w[1] - q[1], w[2] - q[2]) };
        });
        const planArea = Math.abs(ringArea(pts));
        const cosT = Math.cos(r.pitch * DEG);
        const [cx, cy] = ringCentroid(pts);
        const az = DIR_AZIMUTH[side];
        const azTrue = trueAzimuth(az, bearingDeg);
        const zs = pts3.map((q) => q[2]);
        faces.push({
          id: pieces.length > 1 ? `${planeId}#${idx + 1}` : planeId,
          plane: planeId,
          roofId: r.id,
          side,
          pitch: r.pitch,
          azimuth: az,
          azimuthTrue: azTrue,
          aspect: ((azTrue - 180 + 540) % 360) - 180,
          facing: facing8(azTrue),
          pts,
          pts3,
          uv,
          edges,
          area: planArea / cosT,
          planArea,
          centroid: [cx, cy, plane.a * cx + plane.b * cy + plane.c],
          zMin: Math.min(...zs),
          zMax: Math.max(...zs),
          frame,
        });
      });
    }
  }
  return faces;
}

// ---------------------------------------------------------------- queries
/** Height of the plane of a face at (x, y). */
export function faceZAt(face: RoofFace, x: number, y: number): number {
  const n = face.frame.n;
  const p = face.pts3[0];
  return p[2] - (n[0] * (x - p[0]) + n[1] * (y - p[1])) / n[2];
}

/** Is the point inside the (convex, counter-clockwise) plan outline of the face? */
export function faceContains(face: RoofFace, x: number, y: number, tol = 1e-9): boolean {
  const pts = face.pts;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / l < -tol) return false;
  }
  return true;
}

/** The roof surface at (x, y): the face and the height; the highest face wins on shared boundaries. Null if there is no roof. */
export function roofSurfaceAt(faces: RoofFace[], x: number, y: number): { face: RoofFace; z: number } | null {
  let best: { face: RoofFace; z: number } | null = null;
  for (const f of faces) {
    if (!faceContains(f, x, y)) continue;
    const z = faceZAt(f, x, y);
    if (!best || z > best.z) best = { face: f, z };
  }
  return best;
}

/** Convex polygon (counter-clockwise) moved inwards: edge i is shifted by offsets[i]; null if nothing is left. */
export function insetConvex(pts: Pt[], offsets: number[]): Pt[] | null {
  let poly: TPoly | null = { pts, tags: pts.map(() => "x") };
  for (let i = 0; i < pts.length && poly; i++) {
    const hp = leftOf(pts[i], pts[(i + 1) % pts.length]);
    poly = clip(poly, { ...hp, c: hp.c - offsets[i] }, "x");
  }
  return poly ? poly.pts : null;
}

/** Clips a convex ring by the rectangle (plan coordinates); returns the ring or null. */
export function clipRingToRect(ring: Pt[], r: Rect): Pt[] | null {
  let poly: TPoly | null = { pts: ring, tags: ring.map(() => "x") };
  const hps: HalfPlane[] = [
    { a: 1, b: 0, c: -r[0] },
    { a: -1, b: 0, c: r[2] },
    { a: 0, b: 1, c: -r[1] },
    { a: 0, b: -1, c: r[3] },
  ];
  for (const hp of hps) {
    if (!poly) return null;
    poly = clip(poly, hp, "x");
  }
  return poly ? poly.pts : null;
}

/** Clips a convex ring by a half-plane a x + b y + c >= 0 (not necessarily normalised). */
export function clipRingByHalfPlane(ring: Pt[], a: number, b: number, c: number): Pt[] | null {
  const hp = normalise(a, b, c);
  if (!hp) return c >= 0 ? ring : null;
  const out = clip({ pts: ring, tags: ring.map(() => "x") }, hp, "x");
  return out ? out.pts : null;
}
