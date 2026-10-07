import { describe, expect, it } from "vitest";
import { unionOf } from "@/lib/model/geom";
import { ringArea2, triangulate, type P2 } from "../triangulate";

// Oracles: the area of the polygon by the shoelace formula, and coverage by point sampling (even-odd rule over all rings).

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insideRing(p: P2, ring: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const insidePolygon = (p: P2, rings: readonly (readonly P2[])[]) => rings.reduce((s, r) => (insideRing(p, r) ? !s : s), false);

function check(outer: P2[], holes: P2[][]) {
  const pts: P2[] = [...outer, ...holes.flat()];
  const tris = triangulate(outer, holes);
  const area = Math.abs(ringArea2(outer)) / 2 - holes.reduce((s, h) => s + Math.abs(ringArea2(h)) / 2, 0);
  let sum = 0;
  for (const [a, b, c] of tris) {
    const t2 = ringArea2([pts[a], pts[b], pts[c]]);
    expect(t2).toBeGreaterThan(0); // counter-clockwise and not degenerate
    sum += t2 / 2;
  }
  expect(sum).toBeCloseTo(area, 9);
  return { tris, pts, area };
}

describe("triangulate", () => {
  it("splits a square into two triangles", () => {
    const { tris } = check([[0, 0], [1, 0], [1, 1], [0, 1]], []);
    expect(tris).toHaveLength(2);
  });

  it("handles a concave L in both orientations", () => {
    const L: P2[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
    expect(check(L, []).tris).toHaveLength(4);
    expect(check([...L].reverse(), []).tris).toHaveLength(4);
  });

  it("respects a hole: n + 2h + ... triangles that cover the ring only", () => {
    const outer: P2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: P2[] = [[3, 3], [3, 7], [7, 7], [7, 3]];
    const { tris, pts, area } = check(outer, [hole]);
    expect(area).toBeCloseTo(100 - 16, 12);
    expect(tris).toHaveLength(outer.length + hole.length + 2 * 1 - 2); // V + 2H - 2 for a polygon with H holes
    for (const [a, b, c] of tris) {
      const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3, cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3;
      expect(cx > 3 && cx < 7 && cy > 3 && cy < 7).toBe(false);
    }
  });

  it("joins two holes and a hole against an L-shaped outer ring", () => {
    const outer: P2[] = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];
    const holes: P2[][] = [
      [[2, 2], [2, 6], [6, 6], [6, 2]],
      [[2, 10], [2, 17], [6, 17], [6, 10]],
      [[17, 2], [17, 5], [10, 5], [10, 2]], // opposite orientation on purpose
    ];
    check(outer, holes);
  });

  it("covers exactly the polygon: sampled points lie in one triangle iff inside (random rectilinear shapes with holes)", () => {
    const rnd = mulberry32(20260701);
    let withHoles = 0;
    for (let n = 0; n < 40; n++) {
      const rects = Array.from({ length: 3 + Math.floor(rnd() * 6) }, () => {
        const x = Math.floor(rnd() * 10), y = Math.floor(rnd() * 10);
        return [x, y, x + 1 + Math.floor(rnd() * 5), y + 1 + Math.floor(rnd() * 5)] as [number, number, number, number];
      });
      const polys = unionOf(rects).polygons;
      const outers = polys.filter((p) => p.area > 0);
      if (outers.length !== 1) continue; // several separate pieces: each is its own case, tested separately by the walls
      const holes = polys.filter((p) => p.area < 0).map((p) => p.pts as P2[]);
      if (holes.length) withHoles++;
      const { tris, pts } = check(outers[0].pts as P2[], holes);
      const rings = [outers[0].pts as P2[], ...holes];
      for (let s = 0; s < 120; s++) {
        const p: P2 = [rnd() * 17 - 1.1, rnd() * 17 - 1.1];
        const hits = tris.filter(([a, b, c]) => insideRing(p, [pts[a], pts[b], pts[c]])).length;
        expect(hits).toBe(insidePolygon(p, rings) ? 1 : 0);
      }
    }
    expect(withHoles).toBeGreaterThan(0); // the generator really produced shapes with holes
  });

  it("returns nothing for fewer than three vertices", () => {
    expect(triangulate([[0, 0], [1, 1]])).toEqual([]);
  });
});
