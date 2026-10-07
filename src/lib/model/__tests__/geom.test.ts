import { describe, expect, it } from "vitest";
import {
  bboxOf,
  distToSegment,
  doorSwing,
  facing8,
  furnitureRect,
  mergeRects,
  rectHitsSwing,
  ringArea,
  ringCentroid,
  signedDistance,
  trueAzimuth,
  uncovered,
  unionOf,
  wallBody,
  type Rect,
} from "../geom";
import { poleOfInaccessibility } from "../polylabel";

describe("unionOf", () => {
  it("L shape: area, perimeter, polygon, decomposition", () => {
    const u = unionOf([[0, 0, 4, 2], [0, 2, 2, 5]]);
    expect(u.area).toBeCloseTo(14, 12);
    expect(u.perimeter).toBeCloseTo(18, 12);
    expect(u.polygons).toHaveLength(1);
    expect(u.polygons[0].pts).toHaveLength(6);
    expect(u.polygons[0].area).toBeCloseTo(14, 12);
    expect(u.rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0)).toBeCloseTo(14, 12);
    expect(u.bbox).toMatchObject({ x0: 0, y0: 0, x1: 4, y1: 5, w: 4, d: 5 });
  });
  it("overlapping rectangles count once, a ring has a hole with negative area", () => {
    expect(unionOf([[0, 0, 3, 3], [1, 1, 4, 4]]).area).toBeCloseTo(14, 12);
    const ring = unionOf([[0, 0, 6, 2], [0, 4, 6, 6], [0, 2, 2, 4], [4, 2, 6, 4]]);
    expect(ring.polygons.map((p) => p.area).sort((a, b) => a - b)).toEqual([-4, 36]);
  });
  it("empty and degenerate input", () => {
    expect(unionOf([]).area).toBe(0);
    expect(unionOf([[1, 1, 1, 2]]).area).toBe(0);
  });
});

describe("rectangles", () => {
  it("mergeRects joins neighbours with a common side", () => {
    expect(mergeRects([[0, 0, 1, 2], [1, 0, 3, 2], [0, 2, 3, 3]])).toEqual([[0, 0, 3, 3]]);
  });
  it("uncovered reports the part of the targets outside the covers", () => {
    const u = uncovered([[0, 0, 4, 4]], [[0, 0, 2, 4], [2, 0, 4, 2]]);
    expect(u.area).toBeCloseTo(4, 12);
    expect(u.rects).toEqual([[2, 2, 4, 4]]);
    expect(uncovered([[0, 0, 1, 1]], [[-1, -1, 2, 2]]).area).toBe(0);
    expect(uncovered([[0, 0, 1, 1]], [[0.2, 0, 1, 1]], 0.25).area).toBe(0); // tolerance expands the covers
  });
  it("bboxOf", () => {
    expect(bboxOf([])).toBeNull();
    expect(bboxOf([[0, 1, 2, 3], [-1, 0, 1, 5]])).toMatchObject({ x0: -1, y0: 0, x1: 2, y1: 5 });
  });
});

describe("rings", () => {
  const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
  it("area sign and centroid", () => {
    expect(ringArea(sq)).toBe(4);
    expect(ringArea([...sq].reverse())).toBe(-4);
    expect(ringCentroid(sq)).toEqual([1, 1]);
    const tri: [number, number][] = [[0, 0], [3, 0], [0, 3]];
    expect(ringCentroid(tri)[0]).toBeCloseTo(1, 12);
  });
  it("distances", () => {
    expect(distToSegment([1, 1], [0, 0], [2, 0])).toBe(1);
    expect(distToSegment([3, 0], [0, 0], [2, 0])).toBe(1);
    expect(signedDistance([1, 1], [sq])).toBe(1);
    expect(signedDistance([3, 1], [sq])).toBe(-1);
    const hole: [number, number][] = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]];
    expect(signedDistance([1, 1], [sq, hole])).toBe(-0.5); // inside the hole = outside the polygon
  });
});

describe("walls, furniture, doors", () => {
  it("wallBody extends by half the thickness of perpendicular walls at the ends", () => {
    const walls = [
      { orient: "h" as const, at: 0, from: 0, to: 4, t: 0.5 },
      { orient: "v" as const, at: 0, from: 0, to: 3, t: 0.3 },
      { orient: "v" as const, at: 4, from: 0, to: 3, t: 0.5 },
    ];
    expect(wallBody(walls[0], walls)).toEqual([-0.15, -0.25, 4.25, 0.25]);
  });
  it("furniture footprint swaps with 90 degree rotations and honours overrides", () => {
    const cat = { desk: { w: 1.4, d: 0.7 } };
    expect(furnitureRect({ type: "desk", x: 0, y: 0, rot: 0 }, cat).rect).toEqual([-0.7, -0.35, 0.7, 0.35]);
    expect(furnitureRect({ type: "desk", x: 0, y: 0, rot: 90 }, cat).rect).toEqual([-0.35, -0.7, 0.35, 0.7]);
    expect(furnitureRect({ type: "desk", x: 1, y: 1, rot: 0, w: 2, d: 1 }, cat).rect).toEqual([0, 0.5, 2, 1.5]);
    expect(furnitureRect({ type: "unknown", x: 0, y: 0, rot: 0 }, cat).w).toBe(1);
  });
  it("doorSwing: hinge on the wall face of the swing side, quarter circle of the leaf width", () => {
    const sw = doorSwing({ kind: "door", orient: "h", swing: "-", hinge: "+", w: 0.9, c: 5, axis: 2 }, 0.15)!;
    expect(sw.hinge).toEqual([5.45, 2 - 0.075]);
    expect(sw.radius).toBe(0.9);
    expect(sw.leafEnd[1]).toBeCloseTo(2 - 0.075 - 0.9, 12);
    expect(doorSwing({ kind: "window", orient: "h", swing: null, hinge: null, w: 1, c: 0, axis: 0 }, 0.5)).toBeNull();
    const entry = doorSwing({ kind: "entry", orient: "v", swing: "+", hinge: "-", w: 1.2, c: 0, axis: 0 }, 0.5)!;
    expect(entry.radius).toBe(0.9); // the leaf of an entry is at most 0.9 m
    const r: Rect = [sw.hinge[0] - 0.2, sw.hinge[1] - 0.6, sw.hinge[0] + 0.1, sw.hinge[1] - 0.3];
    expect(rectHitsSwing(r, sw)).toBe(true);
    expect(rectHitsSwing([sw.hinge[0] + 2, sw.hinge[1] + 2, sw.hinge[0] + 3, sw.hinge[1] + 3], sw)).toBe(false);
  });
});

describe("orientation helpers", () => {
  it("true azimuth wraps and 8-wind names", () => {
    expect(trueAzimuth(270, 100)).toBe(10);
    expect(trueAzimuth(0, 0)).toBe(0);
    expect(trueAzimuth(180, 12)).toBe(192);
    expect(facing8(192)).toBe("S");
    expect(facing8(0)).toBe("N");
    expect(facing8(359)).toBe("N");
    expect(facing8(40)).toBe("NE");
    expect(facing8(225)).toBe("SW");
    expect(facing8(282)).toBe("W");
  });
});

describe("poleOfInaccessibility", () => {
  it("rectangle: the radius is half of the short side and the point is on the middle line", () => {
    const p = poleOfInaccessibility([[[0, 0], [10, 0], [10, 4], [0, 4]]], 0.001);
    expect(p.r).toBeCloseTo(2, 3);
    expect(p.y).toBeCloseTo(2, 3);
    expect(p.x).toBeGreaterThanOrEqual(2 - 1e-3);
    expect(p.x).toBeLessThanOrEqual(8 + 1e-3);
  });
  it("L shape: the label is in the wide part", () => {
    const L: [number, number][] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 8], [0, 8]];
    const p = poleOfInaccessibility([L], 0.001);
    expect(signedDistance([p.x, p.y], [L])).toBeCloseTo(p.r, 6);
    expect(p.r).toBeGreaterThan(0.9);
  });
  it("respects holes", () => {
    const outer: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: [number, number][] = [[3, 3], [7, 3], [7, 7], [3, 7]];
    const p = poleOfInaccessibility([outer, hole], 0.001);
    expect(signedDistance([p.x, p.y], [outer, hole])).toBeCloseTo(p.r, 6);
    // best in a corner: equidistant from two outer sides and the corner of the hole, a = 3 sqrt2 / (1 + sqrt2)
    expect(p.r).toBeCloseTo((3 * Math.SQRT2) / (1 + Math.SQRT2), 2);
  });
  it("degenerate input", () => {
    expect(poleOfInaccessibility([]).r).toBe(0);
    expect(poleOfInaccessibility([[[0, 0], [1, 1]]]).r).toBe(0);
  });
});
