// Roof decomposition on synthetic roofs: single hips, overlapping hips (valleys), steps, coplanar roofs, and a
// randomised property test against the definition "surface = maximum of the hip roofs".
import { describe, expect, it } from "vitest";
import { ringArea } from "../geom";
import { buildRoofFaces, clipRingByHalfPlane, clipRingToRect, faceContains, faceZAt, insetConvex, roofSurfaceAt, type RoofInput } from "../roofs";

const DEG = Math.PI / 180;
const hip = (id: string, rect: [number, number, number, number], pitch: number, overhang: number, wallTop: number): RoofInput => ({ id, rect, pitch, overhang, wallTop });

/** Height of the maximum of hip roofs at a point (the definition), or null outside all eaves. */
function maxOfHips(roofs: RoofInput[], x: number, y: number): number | null {
  let best: number | null = null;
  for (const r of roofs) {
    const [x0, y0, x1, y1] = r.rect;
    const d = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    if (d < -r.overhang) continue;
    const z = r.wallTop + Math.tan(r.pitch * DEG) * d;
    if (best === null || z > best) best = z;
  }
  return best;
}

function checkFaces(roofs: RoofInput[], bearing = 0): ReturnType<typeof buildRoofFaces> {
  const faces = buildRoofFaces(roofs, bearing);
  for (const f of faces) {
    expect(ringArea(f.pts), f.id).toBeGreaterThan(1e-9);
    f.pts.forEach((p, i) => {
      const a = f.pts[(i + f.pts.length - 1) % f.pts.length];
      const b = f.pts[(i + 1) % f.pts.length];
      expect((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]), `${f.id} convex`).toBeGreaterThanOrEqual(-1e-9);
    });
  }
  return faces;
}

describe("single hip roof", () => {
  const r = hip("A", [0, 0, 12, 8], 25, 0.6, 3);
  const faces = checkFaces([r]);
  const tan = Math.tan(25 * DEG);

  it("has four faces with the right areas and edge kinds", () => {
    expect(faces.map((f) => f.plane)).toEqual(["A.S", "A.E", "A.N", "A.W"]);
    const total = faces.reduce((s, f) => s + f.area, 0);
    expect(total).toBeCloseTo(((12 + 1.2) * (8 + 1.2)) / Math.cos(25 * DEG), 9);
    const kinds = (f: (typeof faces)[number]): string[] => f.edges.map((e) => e.kind).sort();
    expect(kinds(faces[0])).toEqual(["eave", "hip", "hip", "ridge"]); // long south face (trapezoid)
    expect(kinds(faces[1])).toEqual(["eave", "hip", "hip"]); // triangular end
  });

  it("ridge and eave heights follow from the pitch", () => {
    const south = faces[0];
    const ridge = south.pts3.filter((p) => Math.abs(p[2] - (3 + tan * 4)) < 1e-9);
    expect(ridge).toHaveLength(2);
    expect(Math.hypot(ridge[0][0] - ridge[1][0], ridge[0][1] - ridge[1][1])).toBeCloseTo(12 - 8, 9);
    expect(south.zMin).toBeCloseTo(3 - 0.6 * tan, 9);
  });

  it("slope, azimuth and aspect", () => {
    const [S, E, N, W] = faces;
    expect(S.azimuth).toBe(180);
    expect(E.azimuth).toBe(90);
    expect(N.azimuth).toBe(0);
    expect(W.azimuth).toBe(270);
    const rot = buildRoofFaces([r], 30);
    expect(rot[0].azimuthTrue).toBe(210);
    expect(rot[0].aspect).toBe(30); // PVGIS: 0 = south, west positive
    expect(rot[1].azimuthTrue).toBe(120);
    expect(rot[1].aspect).toBe(-60);
    expect(rot[0].facing).toBe("SW");
    expect(S.frame.n[2]).toBeCloseTo(Math.cos(25 * DEG), 12);
  });
});

describe("square roof", () => {
  it("is a pyramid: four triangles, hips only", () => {
    const faces = checkFaces([hip("P", [0, 0, 6, 6], 30, 0, 3)]);
    expect(faces).toHaveLength(4);
    for (const f of faces) {
      expect(f.pts).toHaveLength(3);
      expect(f.edges.map((e) => e.kind).sort()).toEqual(["eave", "hip", "hip"]);
    }
  });
});

describe("two overlapping hips", () => {
  const roofs = [hip("A", [0, 0, 20, 10], 22, 0.8, 3), hip("B", [8, 6, 14, 16], 22, 0.8, 3)];
  const faces = checkFaces(roofs);

  it("produces valleys where the transverse hip meets the main roof", () => {
    const valleys = faces.flatMap((f) => f.edges.filter((e) => e.kind === "valley"));
    expect(valleys.length).toBeGreaterThanOrEqual(4); // both faces of each of the two valleys
    // a valley is straight and as long as its 3D chord
    for (const f of faces) {
      f.edges.forEach((e, i) => {
        const p = f.pts3[i];
        const q = f.pts3[(i + 1) % f.pts3.length];
        expect(e.length).toBeCloseTo(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), 9);
      });
    }
  });

  it("the surface equals the maximum of the hips everywhere", () => {
    for (let x = -1.1; x < 21; x += 0.43) {
      for (let y = -1.1; y < 17; y += 0.41) {
        const z = maxOfHips(roofs, x, y);
        const hit = roofSurfaceAt(faces, x, y);
        if (z === null) expect(hit).toBeNull();
        else expect(hit?.z).toBeCloseTo(z, 8);
      }
    }
  });

  it("plan areas of the faces sum to the union of the eave rectangles", () => {
    const planSum = faces.reduce((s, f) => s + f.planArea, 0);
    const a = 21.6 * 11.6;
    const b = 7.6 * 11.6;
    const overlapX = 14.8 - 7.2;
    const overlapY = 10.8 - 5.2;
    expect(planSum).toBeCloseTo(a + b - overlapX * overlapY, 8);
  });
});

describe("steps and coplanar roofs", () => {
  it("a higher roof sticking out of a lower one gets a step edge on the lower faces", () => {
    const roofs = [hip("L", [0, 0, 20, 12], 20, 0.5, 3), hip("H", [7, 3, 13, 9], 5, 0, 7)];
    const faces = checkFaces(roofs);
    expect(faces.some((f) => f.roofId === "L" && f.edges.some((e) => e.kind === "step"))).toBe(true);
    for (let x = 0.07; x < 20; x += 0.53) for (let y = 0.07; y < 12; y += 0.47) expect(roofSurfaceAt(faces, x, y)!.z).toBeCloseTo(maxOfHips(roofs, x, y)!, 8);
  });

  it("two identical roofs do not double the surface (the later one wins)", () => {
    const one = buildRoofFaces([hip("A", [0, 0, 10, 6], 25, 0.5, 3)], 0);
    const two = checkFaces([hip("A", [0, 0, 10, 6], 25, 0.5, 3), hip("B", [0, 0, 10, 6], 25, 0.5, 3)]);
    expect(two.reduce((s, f) => s + f.planArea, 0)).toBeCloseTo(one.reduce((s, f) => s + f.planArea, 0), 9);
    expect(two.every((f) => f.roofId === "B")).toBe(true);
  });

  it("a roof entirely under another produces no faces", () => {
    const faces = checkFaces([hip("big", [0, 0, 20, 20], 30, 0, 3), hip("tiny", [8, 8, 10, 10], 5, 0, 3)]);
    expect(faces.some((f) => f.roofId === "tiny")).toBe(false);
  });
});

describe("property test: random pairs and triples of hip roofs", () => {
  // deterministic PRNG
  let seed = 123456789;
  const rnd = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const grid = (lo: number, hi: number, step: number): number => lo + Math.floor((rnd() * (hi - lo)) / step) * step;

  it("faces are convex and the surface is the maximum of the hips (300 random configurations)", () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rnd() * 2);
      const roofs: RoofInput[] = [];
      for (let k = 0; k < n; k++) {
        const x0 = grid(0, 10, 0.5);
        const y0 = grid(0, 10, 0.5);
        roofs.push(hip(`R${k}`, [x0, y0, x0 + grid(2, 14, 0.5), y0 + grid(2, 14, 0.5)], pick([10, 15, 22, 30, 40]), pick([0, 0.4, 0.8]), pick([2.5, 3, 3.05, 3.5])));
      }
      const faces = checkFaces(roofs);
      for (let i = 0; i < 40; i++) {
        const x = -1 + rnd() * 26;
        const y = -1 + rnd() * 26;
        const want = maxOfHips(roofs, x, y);
        const hit = roofSurfaceAt(faces, x, y);
        const label = `trial ${trial} at ${x.toFixed(3)},${y.toFixed(3)}`;
        if (want === null) expect(hit, label).toBeNull();
        else {
          expect(hit, label).not.toBeNull();
          expect(hit!.z, label).toBeCloseTo(want, 6);
        }
      }
      // tiling: sum of plan areas = area of the union (inclusion-exclusion is awkward, so use a fine grid estimate)
      let inUnion = 0;
      let inFaces = 0;
      for (let x = -1.0123; x < 25; x += 0.5) {
        for (let y = -1.0371; y < 25; y += 0.5) {
          if (maxOfHips(roofs, x, y) !== null) inUnion++;
          if (faces.some((f) => faceContains(f, x, y, 1e-9))) inFaces++;
        }
      }
      expect(inFaces, `trial ${trial}`).toBe(inUnion);
    }
  }, 60_000);
});

describe("helpers", () => {
  const faces = buildRoofFaces([hip("A", [0, 0, 10, 6], 20, 0, 3)], 0);
  it("faceZAt agrees with the vertices", () => {
    for (const f of faces) f.pts3.forEach((p) => expect(faceZAt(f, p[0], p[1])).toBeCloseTo(p[2], 9));
  });
  it("roofSurfaceAt returns null outside", () => {
    expect(roofSurfaceAt(faces, -5, -5)).toBeNull();
  });
  it("clipRingToRect and clipRingByHalfPlane", () => {
    const sq: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(ringArea(clipRingToRect(sq, [1, 1, 3, 5])!)).toBeCloseTo(6, 12);
    expect(clipRingToRect(sq, [5, 5, 6, 6])).toBeNull();
    expect(ringArea(clipRingByHalfPlane(sq, 1, 1, -4)!)).toBeCloseTo(8, 12); // x + y >= 4
    expect(clipRingByHalfPlane(sq, 0, 0, -1)).toBeNull();
  });
  it("insetConvex shifts every edge by its own offset", () => {
    const sq: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const r = insetConvex(sq, [1, 0, 0.5, 0])!; // bottom +1, top -0.5
    expect(ringArea(r)).toBeCloseTo(4 * 2.5, 12);
    expect(insetConvex(sq, [3, 0, 3, 0])).toBeNull();
  });
});
