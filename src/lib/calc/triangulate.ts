// Triangulation of a simple polygon with holes by ear clipping (holes are joined to the outer ring by bridges, after
// D. Eberly, "Triangulation by Ear Clipping"). Pure TypeScript, used by the printable model (printModel.ts) for the top and
// bottom faces of walls, roof faces and slabs. Polygons here have tens of vertices, so the O(n^3) worst case is irrelevant.

/** A plan point. */
export type P2 = readonly [number, number];

/** Triangle of vertex indices into the concatenation `[...outer, ...holes[0], ...holes[1], ...]`. */
export type Tri = [number, number, number];

/** Twice the signed area of a ring (positive when counter-clockwise). */
export const ringArea2 = (ring: readonly P2[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
};

/** Cross product (b - a) x (c - a): positive for a left turn a -> b -> c. */
const cross = (a: P2, b: P2, c: P2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a: P2, b: P2): boolean => a[0] === b[0] && a[1] === b[1];

/** Smaller than this (in square metres, doubled) a corner counts as straight. Rings come from a model in metres. */
const EPS = 1e-12;

/** Is `p` inside or on the counter-clockwise triangle `a b c`? */
function inTriangle(a: P2, b: P2, c: P2, p: P2): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/**
 * Is the diagonal from the vertex `p` (with ring neighbours `a` before and `b` after, ring counter-clockwise) towards `m`
 * running inside the polygon near `p`?
 */
function locallyInside(a: P2, p: P2, b: P2, m: P2): boolean {
  return cross(a, p, b) > 0
    ? cross(p, b, m) > 0 && cross(a, p, m) > 0
    : cross(p, b, m) > 0 || cross(a, p, m) > 0;
}

/**
 * Triangulates `outer` minus `holes`. The rings may have any orientation. Returns counter-clockwise triangles whose
 * indices refer to the concatenated vertex list `[...outer, ...holes.flat()]`; together the triangles cover exactly the
 * polygon, and every edge of a ring is an edge of the triangulation. Collinear ring vertices are kept as vertices of the
 * rings but yield no sliver triangles when they lie on a boundary shared by the neighbouring triangles; callers that need
 * a watertight prism remove them first.
 */
export function triangulate(outer: readonly P2[], holes: readonly (readonly P2[])[] = []): Tri[] {
  const pts: P2[] = [...outer, ...holes.flat()];
  if (outer.length < 3) return [];

  // index rings: outer counter-clockwise, holes clockwise
  const indexRing = (start: number, count: number, ccw: boolean): number[] => {
    const idx = Array.from({ length: count }, (_, i) => start + i);
    const isCcw = ringArea2(idx.map((i) => pts[i])) > 0;
    return isCcw === ccw ? idx : idx.reverse();
  };
  let ring = indexRing(0, outer.length, true);
  const holeRings: number[][] = [];
  let at = outer.length;
  for (const h of holes) {
    if (h.length >= 3) holeRings.push(indexRing(at, h.length, false));
    at += h.length;
  }
  // rightmost hole first: the bridge of a hole then never crosses a hole that is still unconnected
  const rightmost = (h: number[]) => h.reduce((best, i) => (pts[i][0] > pts[best][0] || (pts[i][0] === pts[best][0] && pts[i][1] < pts[best][1]) ? i : best), h[0]);
  holeRings.sort((a, b) => pts[rightmost(b)][0] - pts[rightmost(a)][0]);

  for (const hole of holeRings) {
    const mi = rightmost(hole), m = pts[mi];
    // nearest ring edge crossed by the ray from m towards +x
    let bestX = Infinity, cand = -1;
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length, a = pts[ring[k]], b = pts[ring[k2]];
      // a horizontal edge never crosses the ray transversally; a vertex lying on the ray is met through its other edge
      if (a[1] === b[1] || m[1] < Math.min(a[1], b[1]) || m[1] > Math.max(a[1], b[1])) continue;
      const x = a[0] + ((m[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x < m[0] || x >= bestX) continue;
      bestX = x;
      // the visible vertex is the end with the larger x, or the vertex that the ray hits exactly
      cand = x === a[0] ? k : x === b[0] ? k2 : a[0] > b[0] ? k : k2;
    }
    if (cand < 0) continue; // cannot happen for a hole inside the outer ring; skip rather than loop
    let pv = ring[cand];
    // a reflex vertex inside the triangle m - hit - candidate would block the view: the one at the smallest angle wins
    const hit: P2 = [bestX, m[1]];
    const pp = pts[pv];
    if (!same(pp, hit)) {
      const tri: [P2, P2, P2] = cross(m, hit, pp) > 0 ? [m, hit, pp] : [m, pp, hit];
      let bestAngle = Infinity, bestDist = Infinity, bestV = -1;
      for (let k = 0; k < ring.length; k++) {
        const v = ring[k], q = pts[v];
        if (v === pv || same(q, pp) || q[0] < m[0]) continue;
        if (!inTriangle(tri[0], tri[1], tri[2], q)) continue;
        const prev = pts[ring[(k + ring.length - 1) % ring.length]], next = pts[ring[(k + 1) % ring.length]];
        if (cross(prev, q, next) > 0) continue; // convex vertices cannot block
        const dx = q[0] - m[0], dy = Math.abs(q[1] - m[1]);
        const angle = Math.atan2(dy, dx), dist = dx * dx + dy * dy;
        if (angle < bestAngle || (angle === bestAngle && dist < bestDist)) { bestAngle = angle; bestDist = dist; bestV = v; }
      }
      if (bestV >= 0) pv = bestV;
    }
    // among repeated occurrences of the vertex (earlier bridges) take the one that sees m
    const slots: number[] = [];
    ring.forEach((v, k) => { if (v === pv || same(pts[v], pts[pv])) slots.push(k); });
    const slot = slots.find((k) => locallyInside(pts[ring[(k + ring.length - 1) % ring.length]], pts[ring[k]], pts[ring[(k + 1) % ring.length]], m)) ?? slots[0];
    const hs = hole.indexOf(mi);
    const around = [...hole.slice(hs), ...hole.slice(0, hs), mi];
    ring = [...ring.slice(0, slot + 1), ...around, ...ring.slice(slot)];
  }

  // ear clipping
  const out: Tri[] = [];
  const guardMax = ring.length * ring.length + 10;
  for (let guard = 0; ring.length > 3 && guard < guardMax; guard++) {
    let clipped = false;
    for (let k = 0; k < ring.length && !clipped; k++) {
      const n = ring.length;
      const ia = ring[(k + n - 1) % n], ib = ring[k], ic = ring[(k + 1) % n];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= EPS) continue; // reflex or straight corner
      let blocked = false;
      for (let j = 0; j < n && !blocked; j++) {
        const q = pts[ring[j]];
        if (same(q, a) || same(q, b) || same(q, c)) continue;
        if (inTriangle(a, b, c, q)) blocked = true;
      }
      if (blocked) continue;
      out.push([ia, ib, ic]);
      ring.splice(k, 1);
      clipped = true;
    }
    if (clipped) continue;
    // no ear found (numerical trouble or a degenerate ring): remove the sharpest convex corner, else drop a straight one
    let best = -1, bestC = EPS;
    for (let k = 0; k < ring.length; k++) {
      const n = ring.length, c = cross(pts[ring[(k + n - 1) % n]], pts[ring[k]], pts[ring[(k + 1) % n]]);
      if (c > bestC) { bestC = c; best = k; }
    }
    if (best >= 0) {
      const n = ring.length;
      out.push([ring[(best + n - 1) % n], ring[best], ring[(best + 1) % n]]);
      ring.splice(best, 1);
    } else {
      ring.splice(0, 1);
    }
  }
  if (ring.length === 3 && cross(pts[ring[0]], pts[ring[1]], pts[ring[2]]) > EPS) out.push([ring[0], ring[1], ring[2]]);
  return out;
}
